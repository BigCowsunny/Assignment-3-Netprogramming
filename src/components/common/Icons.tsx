import React from 'react';
import { LayoutGrid, Server, Bell, Network, Settings, Plus, Search, Radar, RefreshCw, ArrowLeft, LineChart, Download, Image, Trash2, Ban, CheckCircle, ZoomIn, ZoomOut, X, Router, ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react';
interface IconProps extends React.SVGProps<SVGSVGElement> { name: string; size?: number | string; className?: string; }
const icons = {
  'i-grid': LayoutGrid, 'i-server': Server, 'i-bell': Bell, 'i-topo': Network,
  'i-cog': Settings, 'i-plus': Plus, 'i-search': Search, 'i-radar': Radar,
  'i-refresh': RefreshCw, 'i-back': ArrowLeft, 'i-chart': LineChart,
  'i-download': Download, 'i-image': Image, 'i-trash': Trash2, 'i-ban': Ban,
  'i-circle-check': CheckCircle, 'i-zoom-in': ZoomIn, 'i-zoom-out': ZoomOut,
  'i-x': X, 'i-router': Router, 'i-switch': Server, 'i-arrow-right': ArrowRight,
  'i-rotate-ccw': RotateCcw, 'i-triangle-alert': AlertTriangle,
};
export const Icon: React.FC<IconProps> = ({name, size = 16, className = 'ic', ...props}) => {
  const Component = icons[name as keyof typeof icons];
  return Component ? <Component size={size} className={className} aria-hidden="true" strokeWidth={1.7} {...props} /> : null;
};
