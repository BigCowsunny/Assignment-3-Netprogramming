import React from 'react';

interface CiscoDeviceIconProps extends React.SVGProps<SVGSVGElement> {
  deviceType: string;
  size?: number;
}

// Preserve the original Cisco-style device symbols used in the topology.
export const CiscoDeviceIcon: React.FC<CiscoDeviceIconProps> = ({ deviceType, size = 38, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    {deviceType === 'switch' ? <>
      <path d="M537 820.3l-470-230v-222l470 212z" fill="#37BBEF" />
      <path d="M537 820.3l420-230v-220l-420 210z" fill="#2481BA" />
      <path d="M67 368.3l470 212 420-210-494.4-166.6z" fill="#3ED6FF" />
      <path d="M532 266.7l-117.1-7.1 28.7 48 29.5-13.6 102.7 39.2 29.6-14.4-102.9-38.4zM406.8 324.6L290.2 315l28.3 50.4 29.4-13.6L450 394.5l29.6-14.4-102.2-41.9zM605.8 438.1l117.4 5.8-28-52.2-29.8 15.5-102.5-40.5-29.6 14.7 102.3 41.2zM538.8 472.9L437 429l-29.7 14.7 101.8 44.6-29.8 15.5 116.9 8.2-27.6-54.6z" fill="#FFFFFF" />
    </> : <>
      <path d="M77 403.4v228.5c1.5 93.7 195.7 183.5 435 183.5s433.4-89.8 435-183.5V403.4H77z" fill="#1B9BDB" />
      <path d="M947 402.7c0 99.4-194.8 194-435 194s-435-94.6-435-194 194.8-180 435-180 435 80.5 435 180z" fill="#3ED6FF" />
      <path d="M474.1 311.4H503l0.1 63.2h29.5l-0.7-63.2h28.9l-43.7-75.1zM533 417.2h-29.9l0.1 73.9h-30.6l46.2 75.2 45.5-75.2h-30.6zM654.5 380.9l-1.4-30-72.1 45 76.4 45.1-1.4-30h126.2l-2.6-30.1zM381.1 380.9h-125l-2.3 30.1H380l-1.1 30 75.9-45.1-72.5-45z" fill="#FFFFFF" />
    </>}
  </svg>
);
