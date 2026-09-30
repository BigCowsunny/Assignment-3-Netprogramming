"""
Network Scanner for EVE-NG and physical devices
Discovers devices via SNMP, Telnet, SSH
"""

import asyncio
import socket
import ipaddress
from typing import List, Dict, Optional
import logging

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
        device_type = "router"
        if "switch" in sysDescr.lower():
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
    
    clean_host = host.strip().replace("http://", "").replace("https://", "").split("/")[0].split(":")[0]
    if not clean_host:
        return []

    url_base = f"http://{clean_host}"
    devices = []
    
    def sync_api_call():
        try:
            import http.cookiejar
            cj = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
            
            # 1. Login
            login_url = f"{url_base}/api/auth/login"
            payload = json.dumps({"username": username, "password": password, "html5": "-1"}).encode('utf-8')
            req = urllib.request.Request(login_url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with opener.open(req, timeout=2.0) as res:
                res_data = json.loads(res.read().decode('utf-8'))
                if res_data.get("code") != 200 and res_data.get("status") != "success":
                    return []
            
            # 2. Get active folders/labs
            labs_url = f"{url_base}/api/folders"
            req_labs = urllib.request.Request(labs_url, method='GET')
            lab_files = []
            try:
                with opener.open(req_labs, timeout=2.0) as res:
                    folder_data = json.loads(res.read().decode('utf-8'))
                    labs = folder_data.get("data", {}).get("labs", [])
                    for l in labs:
                        lab_files.append(l.get("path") or l.get("name"))
            except Exception:
                pass
                
            if not lab_files:
                lab_files = ["/"]
                
            # 3. Get nodes from each lab
            nodes_found = []
            for lab_path in lab_files:
                if not lab_path:
                    continue
                path_clean = lab_path if lab_path.startswith('/') else '/' + lab_path
                node_url = f"{url_base}/api/labs{path_clean}/nodes"
                try:
                    req_nodes = urllib.request.Request(node_url, method='GET')
                    with opener.open(req_nodes, timeout=2.0) as res:
                        nodes_resp = json.loads(res.read().decode('utf-8'))
                        nodes_dict = nodes_resp.get("data", {})
                        if isinstance(nodes_dict, dict):
                            for n_id, n_data in nodes_dict.items():
                                nodes_found.append(n_data)
                except Exception:
                    continue
            return nodes_found
        except Exception as e:
            logger.debug(f"EVE-NG API scan error for {clean_host}: {e}")
            return []

    try:
        nodes = await asyncio.to_thread(sync_api_call)
        for n in nodes:
            name = n.get("name", "EVE-Node")
            status_num = n.get("status", 0)  # 2 = running, 0 = stopped
            node_status = "online" if status_num == 2 else "offline"
            url_str = n.get("url", "")  # telnet://ip:port
            port = 32768
            if url_str and ":" in url_str:
                try:
                    port = int(url_str.split(":")[-1])
                except ValueError:
                    pass

            template = str(n.get("template", "")).lower()
            name_lower = name.lower()
            dev_type = "switch" if ("sw" in name_lower or "switch" in name_lower or "l2" in template) else "router"

            devices.append({
                "name": name,
                "ip": f"{clean_host}:{port}",
                "port": port,
                "type": dev_type,
                "vendor": f"Cisco {n.get('image', 'EVE-NG')}",
                "descr": f"EVE-NG Node ({n.get('template', 'QEMU')})",
                "status": node_status,
                "method": "eveng_api"
            })
    except Exception as e:
        logger.debug(f"EVE-NG API thread error: {e}")

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
    clean_host = host.strip().replace("http://", "").replace("https://", "").split("/")[0].split(":")[0]
    if not clean_host:
        return []

    logger.info(f"Scanning EVE-NG at {clean_host} (ports {start_port}-{end_port})")
    
    devices = []
    seen_ports = set()
    
    # 1. Try EVE-NG REST API
    try:
        api_devices = await scan_eveng_api(clean_host, username, password)
        if api_devices:
            logger.info(f"  ✓ Found {len(api_devices)} nodes via EVE-NG REST API")
            for dev in api_devices:
                devices.append(dev)
                if dev.get("port"):
                    seen_ports.add(dev["port"])
    except Exception as e:
        logger.debug(f"EVE-NG REST API error: {e}")
                
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
                
    logger.info(f"EVE-NG scan complete: {len(devices)} total devices found")
    return devices


