import React from 'react';
import {
  LayoutGrid,
  Server,
  Bell,
  Network,
  Settings,
  Plus,
  Search,
  Radar,
  RefreshCw,
  ArrowLeft,
  LineChart,
  Download,
  Image as ImageIcon,
  Trash2,
  Ban,
  CheckCircle,
  ZoomIn,
  ZoomOut,
  X,
  Router as RouterIcon,
  ArrowRight,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: string;
  size?: number | string;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, className = 'ic', ...props }) => {
  const commonProps = { size, className, ...props };

  switch (name) {
    case 'i-grid':
      return <LayoutGrid {...commonProps} />;
    case 'i-server':
      return <Server {...commonProps} />;
    case 'i-bell':
      return <Bell {...commonProps} />;
    case 'i-topo':
      return <Network {...commonProps} />;
    case 'i-cog':
      return <Settings {...commonProps} />;
    case 'i-plus':
      return <Plus {...commonProps} />;
    case 'i-search':
      return <Search {...commonProps} />;
    case 'i-radar':
      return <Radar {...commonProps} />;
    case 'i-refresh':
      return <RefreshCw {...commonProps} />;
    case 'i-back':
      return <ArrowLeft {...commonProps} />;
    case 'i-chart':
      return <LineChart {...commonProps} />;
    case 'i-download':
      return <Download {...commonProps} />;
    case 'i-image':
      return <ImageIcon {...commonProps} />;
    case 'i-trash':
      return <Trash2 {...commonProps} />;
    case 'i-ban':
      return <Ban {...commonProps} />;
    case 'i-circle-check':
      return <CheckCircle {...commonProps} />;
    case 'i-zoom-in':
      return <ZoomIn {...commonProps} />;
    case 'i-zoom-out':
      return <ZoomOut {...commonProps} />;
    case 'i-x':
      return <X {...commonProps} />;
    case 'i-router':
      return (
        <svg 
          width={size} 
          height={size} 
          viewBox="0 0 1024 1024" 
          className={className}
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path d="M77 403.4v228.5c1.5 93.7 195.7 183.5 435 183.5s433.4-89.8 435-183.5V403.4H77z" fill="#1B9BDB" />
          <path d="M947 402.7c0 99.4-194.8 194-435 194s-435-94.6-435-194 194.8-180 435-180 435 80.5 435 180z" fill="#3ED6FF" />
          <path d="M474.1 311.4H503l0.1 63.2h29.5l-0.7-63.2h28.9l-43.7-75.1zM533 417.2h-29.9l0.1 73.9h-30.6l46.2 75.2 45.5-75.2h-30.6zM654.5 380.9l-1.4-30-72.1 45 76.4 45.1-1.4-30h126.2l-2.6-30.1zM381.1 380.9h-125l-2.3 30.1H380l-1.1 30 75.9-45.1-72.5-45z" fill="#FFFFFF" />
        </svg>
      );
    case 'i-switch':
      return (
        <svg 
          width={size} 
          height={size} 
          viewBox="0 0 1024 1024" 
          className={className}
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path d="M537 820.3l-470-230v-222l470 212z" fill="#37BBEF" />
          <path d="M537 820.3l420-230v-220l-420 210z" fill="#2481BA" />
          <path d="M67 368.3l470 212 420-210-494.4-166.6z" fill="#3ED6FF" />
          <path d="M532 266.7l-117.1-7.1 28.7 48 29.5-13.6 102.7 39.2 29.6-14.4-102.9-38.4zM406.8 324.6L290.2 315l28.3 50.4 29.4-13.6L450 394.5l29.6-14.4-102.2-41.9zM605.8 438.1l117.4 5.8-28-52.2-29.8 15.5-102.5-40.5-29.6 14.7 102.3 41.2zM538.8 472.9L437 429l-29.7 14.7 101.8 44.6-29.8 15.5 116.9 8.2-27.6-54.6z" fill="#FFFFFF" />
        </svg>
      );
    case 'i-arrow-right':
      return <ArrowRight {...commonProps} />;
    case 'i-rotate-ccw':
      return <RotateCcw {...commonProps} />;
    case 'i-triangle-alert':
      return <AlertTriangle {...commonProps} />;
    default:
      return null;
  }
};
