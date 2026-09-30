"""
Network Scanner for EVE-NG and physical devices
Discovers devices via SNMP, Telnet, SSH
"""

import asyncio
import socket
import ipaddress
from typing import List, Dict, Optional
import logging
from urllib.parse import quote, urlsplit

logger = logging.getLogger("network_scanner")


async def check_port(host: str, port: int, timeout: float = 1.0) -> bool:
    """Check if a port is open"""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except:
        return False


async def scan_snmp(host: str, community: str = "public") -> Optional[Dict]:
    """Scan device via SNMP"""
    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
            ObjectType, ObjectIdentity, get_cmd
        )
        
        engine = SnmpEngine()
        transport = await UdpTransportTarget.create((host, 161), timeout=2.0, retries=1)
        
        # Get sysName and sysDescr
        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity('SNMPv2-MIB', 'sysName', 0)),
            ObjectType(ObjectIdentity('SNMPv2-MIB', 'sysDescr', 0))
        )
        
        if errorIndication or errorStatus:
            return None
        
        sysName = str(varBinds[0][1]) if len(varBinds) > 0 else "Unknown"
        sysDescr = str(varBinds[1][1]) if len(varBinds) > 1 else ""
        
        # Determine device type
        description = sysDescr.lower()
        device_type = "router"
        if any(token in description for token in ("switch", "catalyst", "nexus", "iol l2", "c2960", "c3560", "c3750", "c3850", "c1000", "cat9k", "cat3k", "cat4k")):
            device_type = "switch"
        
        return {
            "name": sysName,
            "descr": sysDescr,
            "type": device_type,
            "method": "snmp",
            "community": community
        }
        
    except Exception as e:
        logger.debug(f"SNMP scan failed for {host}: {e}")
        return None


async def scan_telnet(host: str, port: int = 23) -> Optional[Dict]:
    """Scan device via Telnet (EVE-NG console port)"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=2.5
        )
        
        # Send newlines to trigger Cisco IOS CLI prompt
        writer.write(b"\r\n")
        await writer.drain()
        await asyncio.sleep(0.4)
        writer.write(b"\r\n")
        await writer.drain()
        
        banner = await asyncio.wait_for(reader.read(2048), timeout=2.0)
        writer.close()
        await writer.wait_closed()
        
        banner_text = banner.decode('utf-8', errors='ignore')
        
        # Extract hostname from prompt line (e.g. "R1#", "Core-SW1>", "Switch#")
        hostname = f"Device-P{port}"
        device_type = "router"
        vendor = "Cisco (EVE-NG)"
        
        import re
        prompt_match = re.search(r'([A-Za-z0-9_-]{2,30})[#>]', banner_text)
        if prompt_match:
            candidate = prompt_match.group(1).strip()
            if candidate.lower() not in ["user", "password", "login", "username"]:
                hostname = candidate
                
        name_lower = hostname.lower()
        if "switch" in name_lower or "sw" in name_lower or "l2" in name_lower or "Switch" in banner_text:
            device_type = "switch"
        elif "router" in name_lower or "rtr" in name_lower or "r1" in name_lower or "r2" in name_lower or "Router" in banner_text:
            device_type = "router"
            
        return {
            "name": hostname,
            "descr": f"EVE-NG Telnet Console ({host}:{port})",
            "type": device_type,
            "vendor": vendor,
            "method": "telnet",
            "port": port,
            "ip": f"{host}:{port}",
            "status": "online"
        }
        
    except Exception as e:
        logger.debug(f"Telnet scan failed for {host}:{port}: {e}")
        return None


async def scan_eveng_api(host: str, username: str = "admin", password: str = "eve") -> List[Dict]:
    """Scan EVE-NG via REST API (login -> get labs -> get nodes)"""
    import urllib.request
    import json
    
    raw_host = host.strip().rstrip("/")
    parsed_host = urlsplit(raw_host if "://" in raw_host else f"http://{raw_host}")
    clean_host = parsed_host.hostname or ""
    if not clean_host:
        return []

    url_base = f"{parsed_host.scheme}://{parsed_host.netloc}"
    devices = []
    
    def sync_api_call():
        try:
            import http.cookiejar
            import ssl
            cj = http.cookiejar.CookieJar()
            handlers = [urllib.request.HTTPCookieProcessor(cj)]
            if parsed_host.scheme == "https":
                # EVE-NG commonly uses a self-signed certificate on local labs.
                handlers.append(urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
            opener = urllib.request.build_opener(*handlers)
            
            # 1. Login (html5 is only needed by EVE-NG Pro over HTTPS).
            login_url = f"{url_base}/api/auth/login"
            login_payload = {"username": username, "password": password}
            if parsed_host.scheme == "https":
                login_payload["html5"] = "0"
            payload = json.dumps(login_payload).encode('utf-8')
            req = urllib.request.Request(login_url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with opener.open(req, timeout=8.0) as res:
                res_data = json.loads(res.read().decode('utf-8'))
                if str(res_data.get("code")) != "200" and res_data.get("status") != "success":
                    raise RuntimeError(f"EVE-NG login failed: {res_data.get('message', 'ตรวจสอบ username/password')}")
            
            # 2. Read the logged-in user's root folder, then walk nested folders.
            auth_req = urllib.request.Request(f"{url_base}/api/auth", headers={'Content-Type': 'application/json'}, method='GET')
            with opener.open(auth_req, timeout=8.0) as res:
                auth_data = json.loads(res.read().decode('utf-8'))
            if auth_data.get("status") != "success":
                raise RuntimeError(f"EVE-NG auth check failed: {auth_data.get('message', 'session ไม่ถูกต้อง')}")
            user_data = auth_data.get("data", {})
            root_folder = user_data.get("folder") or "/"
            if not root_folder.startswith("/"):
                root_folder = "/" + root_folder

            lab_files = []
            pending_folders = [root_folder]
            visited_folders = set()
            while pending_folders:
                folder_path = pending_folders.pop(0)
                if folder_path in visited_folders:
                    continue
                visited_folders.add(folder_path)
                encoded_folder = quote(folder_path.strip("/"), safe="/")
                folder_url = f"{url_base}/api/folders/{encoded_folder}" if encoded_folder else f"{url_base}/api/folders/"
                req_folder = urllib.request.Request(folder_url, headers={'Content-Type': 'application/json'}, method='GET')
                with opener.open(req_folder, timeout=8.0) as res:
                    folder_data = json.loads(res.read().decode('utf-8'))
                if folder_data.get("status") != "success":
                    raise RuntimeError(f"EVE-NG folder listing failed: {folder_data.get('message', folder_path)}")
                data = folder_data.get("data", {})
                if not isinstance(data, dict):
                    continue
                for lab in data.get("labs", []) or []:
                    lab_path = lab.get("path") if isinstance(lab, dict) else lab if isinstance(lab, str) else None
                    if lab_path:
                        lab_files.append(lab_path)
                for folder in data.get("folders", []) or []:
                    child_path = folder.get("path") if isinstance(folder, dict) else folder if isinstance(folder, str) else None
                    if child_path and child_path != "..":
                        if not child_path.startswith("/"):
                            child_path = f"{folder_path.rstrip('/')}/{child_path}"
                        pending_folders.append(child_path)
                
            # 3. Read nodes from all labs, including labs nested under folders.
            nodes_found = []
            for lab_path in dict.fromkeys(lab_files):
                path_clean = quote(str(lab_path).strip('/'), safe="/")
                if not path_clean:
                    continue
                node_path = f"/api/labs/{path_clean}/nodes"
                node_url = f"{url_base}{node_path}"
                req_nodes = urllib.request.Request(node_url, headers={'Content-Type': 'application/json'}, method='GET')
                with opener.open(req_nodes, timeout=8.0) as res:
                    nodes_resp = json.loads(res.read().decode('utf-8'))
                if nodes_resp.get("status") != "success":
                    continue
                nodes_dict = nodes_resp.get("data", {})
                if isinstance(nodes_dict, dict):
                    for n_id, n_data in nodes_dict.items():
                        if isinstance(n_data, dict):
                            n_data.setdefault("id", n_id)
                            n_data.setdefault("lab_path", lab_path)
                            nodes_found.append(n_data)
            return nodes_found
        except Exception as e:
            logger.warning(f"EVE-NG API scan error for {clean_host}: {e}")
            raise RuntimeError(f"เชื่อมต่อ EVE-NG API ไม่สำเร็จ: {e}") from e

    try:
        nodes = await asyncio.to_thread(sync_api_call)
        for n in nodes:
            name = n.get("name", "EVE-Node")
            try:
                status_num = int(n.get("status", 0))  # 2 = running, 0 = stopped
            except (TypeError, ValueError):
                status_num = 0
            node_status = "online" if status_num == 2 else "offline"
            url_str = n.get("url", "")  # telnet://ip:port
            try:
                console_port = urlsplit(url_str).port if url_str else None
            except ValueError:
                console_port = None

            template = str(n.get("template", "")).lower()
            image = str(n.get("image", "")).lower()
            name_lower = name.lower()
            dev_type = "switch" if ("switch" in name_lower or "sw" in name_lower or "l2" in template or ("iol" in template and "l2" in image)) else "router"

            devices.append({
                "name": name,
                # Preserve uniqueness for stopped nodes without a console URL.
                "ip": f"{clean_host}:{console_port}" if console_port else f"{clean_host}:node-{n.get('id', name)}",
                "port": console_port,
                "type": dev_type,
                "vendor": f"Cisco {n.get('image', 'EVE-NG')}",
                "descr": f"EVE-NG Node ({n.get('template', 'QEMU')})",
                "status": node_status,
                "method": "eveng_api"
            })
    except Exception as e:
        logger.warning(f"EVE-NG API thread error for {clean_host}: {e}")
        raise

    return devices


async def scan_host(host: str, communities: List[str] = ["public"]) -> Optional[Dict]:
    """Scan a single host with multiple methods"""
    logger.info(f"Scanning {host}...")
    
    # Try SNMP first (most reliable)
    for community in communities:
        result = await scan_snmp(host, community)
        if result:
            result["ip"] = host
            logger.info(f"  ✓ Found via SNMP: {result['name']}")
            return result
    
    # Try telnet (EVE-NG console ports)
    for port in [23, 32768, 32769, 32770, 32771, 32772]:
        if await check_port(host, port, timeout=0.5):
            result = await scan_telnet(host, port)
            if result:
                result["ip"] = host
                logger.info(f"  ✓ Found via Telnet port {port}")
                return result
    
    return None


async def scan_network(
    network: str = "192.168.1.0/24",
    communities: List[str] = ["public"],
    max_concurrent: int = 50
) -> List[Dict]:
    """
    Scan entire network for devices
    """
    logger.info(f"Starting network scan: {network}")
    
    try:
        ip_network = ipaddress.ip_network(network, strict=False)
    except ValueError as e:
        logger.error(f"Invalid network: {e}")
        return []
    
    hosts = [str(ip) for ip in ip_network.hosts()]
    logger.info(f"Scanning {len(hosts)} hosts...")
    
    devices = []
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def scan_with_semaphore(host: str):
        async with semaphore:
            result = await scan_host(host, communities)
            if result:
                devices.append(result)
    
    await asyncio.gather(*[scan_with_semaphore(host) for host in hosts])
    
    logger.info(f"Scan complete: {len(devices)} devices found")
    return devices


async def scan_eveng_ports(
    host: str,
    start_port: int = 32768,
    end_port: int = 32775,
    username: str = "admin",
    password: str = "eve"
) -> List[Dict]:
    """
    Scan EVE-NG via REST API first, then Telnet console ports
    """
    raw_host = host.strip()
    parsed_host = urlsplit(raw_host if "://" in raw_host else f"http://{raw_host}")
    clean_host = parsed_host.hostname or ""
    if not clean_host:
        return []

    logger.info(f"Scanning EVE-NG at {clean_host} (ports {start_port}-{end_port})")
    
    devices = []
    seen_ports = set()
    
    # 1. Try EVE-NG REST API
    try:
        api_devices = await scan_eveng_api(host, username, password)
        if api_devices:
            logger.info(f"  ✓ Found {len(api_devices)} nodes via EVE-NG REST API")
            for dev in api_devices:
                devices.append(dev)
                if dev.get("port"):
                    seen_ports.add(dev["port"])
    except Exception as e:
        logger.warning(f"EVE-NG REST API error: {e}")
        api_error = e
                
    # 2. Scan Telnet console ports
    try:
        for port in range(start_port, end_port + 1):
            if port in seen_ports:
                continue
            if await check_port(clean_host, port, timeout=0.5):
                result = await scan_telnet(clean_host, port)
                if result:
                    result["ip"] = f"{clean_host}:{port}"
                    devices.append(result)
                    logger.info(f"  ✓ Found device on telnet port {port}: {result['name']}")
    except Exception as e:
        logger.debug(f"Telnet port sweep error: {e}")
                
    if not devices and 'api_error' in locals():
        raise RuntimeError(str(api_error))

    logger.info(f"EVE-NG scan complete: {len(devices)} total devices found")
    return devices


