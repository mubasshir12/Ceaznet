import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { AlertTriangle, Wrench, Beaker, ChevronDown, ChevronUp } from 'lucide-react';

interface SystemBannerData {
    id: string;
    banner_type: string;
    is_active: boolean;
}

const PREDEFINED_BANNERS: Record<string, { icon: React.ElementType, title: string, description: string, colors: { bg: string, border: string, title: string, desc: string, icon: string, iconBg: string } }> = {
    'maintenance': {
        icon: Wrench,
        title: 'System Maintenance',
        description: 'The system is currently undergoing scheduled maintenance. Some features may be temporarily unavailable.',
        colors: {
            bg: 'bg-amber-50 dark:bg-[#251A0B]',
            border: 'border-amber-200/60 dark:border-amber-900/40',
            title: 'text-amber-900 dark:text-amber-400',
            desc: 'text-amber-800/90 dark:text-amber-500/90',
            iconBg: 'bg-amber-200/50 dark:bg-amber-500/10',
            icon: 'text-amber-700 dark:text-amber-500'
        }
    },
    'development': {
        icon: Wrench,
        title: 'Under Development',
        description: 'This environment is actively under development. You may experience bugs or unexpected behavior.',
        colors: {
            bg: 'bg-blue-50 dark:bg-[#061726]',
            border: 'border-blue-200/60 dark:border-blue-900/40',
            title: 'text-blue-900 dark:text-blue-400',
            desc: 'text-blue-800/90 dark:text-blue-500/90',
            iconBg: 'bg-blue-200/50 dark:bg-blue-500/10',
            icon: 'text-blue-700 dark:text-blue-500'
        }
    },
    'testing': {
        icon: Beaker,
        title: 'Beta Testing',
        description: 'You are currently using a testing environment. Please report any issues you encounter.',
        colors: {
            bg: 'bg-indigo-50 dark:bg-[#120E24]',
            border: 'border-indigo-200/60 dark:border-indigo-900/40',
            title: 'text-indigo-900 dark:text-indigo-400',
            desc: 'text-indigo-800/90 dark:text-indigo-500/90',
            iconBg: 'bg-indigo-200/50 dark:bg-indigo-500/10',
            icon: 'text-indigo-700 dark:text-indigo-500'
        }
    },
    'alert': {
        icon: AlertTriangle,
        title: 'Important Alert',
        description: 'We are currently experiencing performance degradation. Our team is investigating the issue.',
        colors: {
            bg: 'bg-red-50 dark:bg-[#2A0E12]',
            border: 'border-red-200/60 dark:border-red-900/40',
            title: 'text-red-900 dark:text-red-400',
            desc: 'text-red-800/90 dark:text-red-500/90',
            iconBg: 'bg-red-200/50 dark:bg-red-500/10',
            icon: 'text-red-700 dark:text-red-500'
        }
    }
};

export const SystemBanner: React.FC = () => {
    const [banner, setBanner] = useState<SystemBannerData | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        const fetchBanner = async () => {
            try {
                // Fetch broadcast where type = 'system_banner' and is_active = true
                const { data, error } = await supabase
                    .from('broadcasts')
                    .select('id, banner_type, is_active')
                    .eq('type', 'system_banner')
                    .eq('is_active', true)
                    .limit(1);
                
                if (error) {
                    console.error("SystemBanner fetch error (likely 'type', 'banner_type' or 'is_active' column missing):", error.message);
                    setHasError(true);
                    return;
                }

                if (data && data.length > 0) {
                    setBanner(data[0]);
                } else {
                    setBanner(null);
                }
            } catch (error) {
                console.error("Error fetching system banner:", error);
            }
        };

        fetchBanner();

        const uniqueChannelId = `system_banner_changes_${Math.random().toString(36).substring(7)}`;
        const channel = supabase.channel(uniqueChannelId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'broadcasts' },
                (payload) => {
                    console.log(`Realtime Broadcast change detected in SystemBanner [${uniqueChannelId}], refetching... Payload:`, payload);
                    fetchBanner();
                }
            )
            .subscribe((status) => {
                console.log(`Supabase Realtime SystemBanner channel status [${uniqueChannelId}]: ${status}`);
                if (status === 'SUBSCRIBED') {
                    fetchBanner(); // ensure it's up to date upon reconnecting
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    if (!banner || hasError || !banner.is_active) return null;

    const bannerConfig = PREDEFINED_BANNERS[banner.banner_type] || PREDEFINED_BANNERS['alert'];
    const Icon = bannerConfig.icon;

    return (
        <div 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`w-full ${bannerConfig.colors.bg} border-b ${bannerConfig.colors.border} pointer-events-auto transition-all duration-300 relative z-50 cursor-pointer`}
        >
            {/* Safe area top for mobile web apps */}
            <div className="pt-safe" />
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 md:py-2 flex items-start sm:items-center justify-between gap-2 sm:gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center flex-1 overflow-hidden gap-1 sm:gap-0 pt-0.5 sm:pt-0">
                    <div className="flex items-start sm:items-center gap-2 sm:gap-3 shrink-0 sm:pr-3">
                        <div className={`shrink-0 ${bannerConfig.colors.iconBg} p-1 rounded-md hidden sm:flex items-center justify-center`}>
                            <Icon className={`w-4 h-4 ${bannerConfig.colors.icon}`} strokeWidth={2.5}/>
                        </div>
                        <Icon className={`w-[16px] h-[16px] sm:hidden shrink-0 mt-[1px] md:mt-0 ${bannerConfig.colors.icon}`} strokeWidth={2.5}/>
                        
                        <span className={`font-medium text-sm leading-tight shrink-0 pt-0.5 sm:pt-0 ${bannerConfig.colors.title}`}>
                            {bannerConfig.title}
                        </span>
                    </div>
                    
                    <div className={`text-[13px] leading-snug sm:text-sm sm:leading-tight ${bannerConfig.colors.desc} ${isCollapsed ? 'line-clamp-1 sm:line-clamp-none sm:truncate' : ''}`}>
                        {bannerConfig.description}
                    </div>
                </div>
                
                <div className={`shrink-0 -mr-1 mt-1 sm:mt-0 self-center transition-transform ${bannerConfig.colors.icon}`}>
                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </div>
            </div>
        </div>
    );
};
