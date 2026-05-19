import React, { useState, useEffect } from 'react';
import { UIPreferences, UserProfile, View } from '../types';
import { 
    Type, 
    Monitor, 
    Sun, 
    Moon, 
    Trash2, 
    Key, 
    Palette, 
    Cpu,
    Layout,
    Maximize,
    Minimize
} from 'lucide-react';
import { motion } from 'motion/react';
import ConfirmationModal from './ConfirmationModal';
import ApiKeyModal from './ApiKeyModal';
import { getSetting } from '../services/dbService';
import { useAuth } from '../hooks/useAuth';
import metadata from '../metadata.json';
import packageInfo from '../package.json';

interface SettingsViewProps {
    onBack: () => void;
    onNavigate: (view: View) => void;
    preferences: UIPreferences;
    onUpdatePreferences: (newPrefs: Partial<UIPreferences>) => void;
    currentTheme: 'light' | 'dark' | 'system';
    onThemeChange: (theme: 'light' | 'dark' | 'system') => void;
    userProfile?: UserProfile;
    onEditProfile: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ 
    preferences, 
    onUpdatePreferences,
    currentTheme,
    onThemeChange,
    userProfile,
    onEditProfile,
    onNavigate
}) => {
    
    const { user, logout } = useAuth();
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
    const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
    const [apiKey, setApiKey] = useState<string | null>(null);

    useEffect(() => {
        getSetting<string>('kalina_api_key', user).then(storedKey => {
            if (storedKey) setApiKey(storedKey);
        });
    }, [user]);

    const handleClearData = () => {
        localStorage.removeItem('kalina_active_conversation_id');
        localStorage.removeItem('kalina_ui_preferences');
        window.location.reload();
    };

    const handleApiKeyUpdate = (newKey: string) => {
        window.dispatchEvent(new CustomEvent('update-api-key', { detail: newKey }));
        setApiKey(newKey);
        setIsApiKeyModalOpen(false);
    };

    const fonts = [
        { id: 'sans', label: 'Geist Sans', class: 'font-sans' },
        { id: 'inter', label: 'Inter', class: 'font-inter' },
        { id: 'quicksand', label: 'Quicksand', class: 'font-quicksand' },
        { id: 'serif', label: 'Source Serif', class: 'font-serif' },
        { id: 'playfair', label: 'Playfair', class: 'font-playfair' },
        { id: 'mono', label: 'JetBrains', class: 'font-mono' },
    ];

    const radii = [
        { id: 'small', label: 'Sharp', radius: '4px' },
        { id: 'medium', label: 'Soft', radius: '8px' },
        { id: 'large', label: 'Round', radius: '16px' },
        { id: 'full', label: 'Full', radius: '24px' }
    ];

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1,
            transition: {
                type: "spring" as const,
                stiffness: 100,
                damping: 15
            }
        }
    };

    return (
        <>
            <motion.main 
                initial="hidden"
                animate="visible"
                variants={containerVariants}
                className="relative z-10 h-full overflow-y-auto bg-gray-50 dark:bg-black transition-colors duration-300 pt-20 md:pt-24 pb-6"
            >
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mt-4">

                        {/* --- PROFILE CARD --- */}
                        <motion.div variants={itemVariants} className="col-span-1 md:col-span-2 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-all relative overflow-hidden group flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                            
                            <div className="relative z-10 flex items-center gap-4 w-full sm:w-auto">
                                <div className="relative shrink-0">
                                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 p-1 shadow-md">
                                        <div className="w-full h-full rounded-full bg-white dark:bg-black flex items-center justify-center overflow-hidden">
                                            {userProfile?.avatar_url ? (
                                                <img src={userProfile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-xl sm:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-indigo-500 to-purple-600">
                                                    {userProfile?.full_name?.[0].toUpperCase() || user?.email?.[0].toUpperCase() || 'U'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`absolute bottom-1 right-1 w-3.5 h-3.5 border-2 border-white dark:border-black rounded-full ${user ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                </div>
                                
                                <div className="text-left">
                                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white leading-tight mb-1">
                                        {user ? (userProfile?.full_name || user?.email?.split('@')[0]) : 'Guest User'}
                                    </h2>
                                    <p className="text-sm text-gray-500 dark:text-white/60 font-medium">
                                        {user ? user?.email : 'Sign in to sync your data'}
                                    </p>
                                    {user?.last_sign_in_at && (
                                        <p className="text-xs text-gray-400 dark:text-white/40 mt-1 flex items-center gap-1">
                                            Last sign in: {new Date(user.last_sign_in_at).toLocaleString(undefined, {
                                                dateStyle: 'medium',
                                                timeStyle: 'short'
                                            })}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {user && (
                                <div className="flex items-center gap-3 w-full sm:w-auto relative z-10">
                                    <button 
                                        onClick={onEditProfile}
                                        className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-semibold bg-gray-900 dark:bg-white text-white dark:text-black rounded-xl hover:bg-gray-800 dark:hover:bg-gray-200 transition-all shadow-sm active:scale-95 whitespace-nowrap"
                                    >
                                        Edit Profile
                                    </button>
                                    <button 
                                        onClick={() => logout()}
                                        className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-semibold bg-white dark:bg-white/5 text-red-600 dark:text-red-400 border border-gray-200 dark:border-white/10 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-all active:scale-95 whitespace-nowrap"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </motion.div>
                        
                        {/* --- THEME CARD --- */}
                        <motion.div variants={itemVariants} className="col-span-1 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-2 bg-purple-100 dark:bg-purple-500/10 rounded-xl text-purple-600 dark:text-purple-400">
                                    <Palette className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Appearance</h2>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { id: 'light', icon: Sun, label: 'Light' },
                                    { id: 'system', icon: Monitor, label: 'Auto' },
                                    { id: 'dark', icon: Moon, label: 'Dark' }
                                ].map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => onThemeChange(t.id as any)}
                                        className={`
                                            relative flex flex-col items-center justify-center py-4 px-2 rounded-2xl border transition-all duration-200
                                            ${currentTheme === t.id 
                                                ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-500 shadow-sm' 
                                                : 'bg-gray-50 dark:bg-white/5 border-transparent hover:bg-gray-100 dark:hover:bg-white/10 hover:border-gray-200 dark:hover:border-white/20'
                                            }
                                        `}
                                    >
                                        <t.icon className={`w-6 h-6 mb-2 ${currentTheme === t.id ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-white/60'}`} />
                                        <span className={`text-xs font-semibold ${currentTheme === t.id ? 'text-purple-700 dark:text-purple-300' : 'text-gray-600 dark:text-white/60'}`}>{t.label}</span>
                                    </button>
                                ))}
                            </div>
                        </motion.div>

                        {/* --- LAYOUT CARD --- */}
                        <motion.div variants={itemVariants} className="col-span-1 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-2 bg-blue-100 dark:bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
                                    <Layout className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Interface</h2>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-600 dark:text-white/60">Density</span>
                                    <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-xl">
                                        {['comfortable', 'compact'].map((layout) => (
                                            <button
                                                key={layout}
                                                onClick={() => onUpdatePreferences({ layoutDensity: layout as any })}
                                                className={`
                                                    px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-2
                                                    ${preferences.layoutDensity === layout 
                                                        ? 'bg-white dark:bg-white/10 text-blue-600 dark:text-blue-400 shadow-sm' 
                                                        : 'text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white'
                                                    }
                                                `}
                                            >
                                                {layout === 'comfortable' ? <Maximize className="w-4 h-4" /> : <Minimize className="w-4 h-4" />}
                                                <span className="capitalize">{layout}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-600 dark:text-white/60">Corners</span>
                                    <div className="flex gap-2">
                                        {radii.map((r) => (
                                            <button
                                                key={r.id}
                                                onClick={() => onUpdatePreferences({ borderRadius: r.id as any })}
                                                className={`
                                                    w-10 h-10 rounded-xl border transition-all flex items-center justify-center
                                                    ${preferences.borderRadius === r.id 
                                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' 
                                                        : 'border-transparent bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/40 hover:bg-gray-100 dark:hover:bg-white/10'
                                                    }
                                                `}
                                                title={r.label}
                                            >
                                                <div 
                                                    className="w-4 h-4 border-2 border-current opacity-80"
                                                    style={{ borderRadius: r.radius }} 
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-white/10">
                                    <span className="text-sm font-medium text-gray-600 dark:text-white/60">Show Time Bubble</span>
                                    <button
                                        onClick={() => onUpdatePreferences({ showTimeBubble: preferences.showTimeBubble === false ? true : false })}
                                        className={`
                                            relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                                            ${preferences.showTimeBubble !== false ? 'bg-blue-600' : 'bg-gray-200 dark:bg-white/10'}
                                        `}
                                    >
                                        <span
                                            className={`
                                                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                                ${preferences.showTimeBubble !== false ? 'translate-x-6' : 'translate-x-1'}
                                            `}
                                        />
                                    </button>
                                </div>
                            </div>
                        </motion.div>

                        {/* --- TYPOGRAPHY CARD --- */}
                        <motion.div variants={itemVariants} className="col-span-1 md:col-span-2 bg-white dark:bg-black border border-gray-200 dark:border-white/10 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-2 bg-emerald-100 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
                                    <Type className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Typography</h2>
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row gap-6 md:gap-8">
                                <div className="flex-1 grid grid-cols-3 sm:grid-cols-6 gap-3">
                                    {fonts.map((font) => (
                                        <button
                                            key={font.id}
                                            onClick={() => onUpdatePreferences({ fontFamily: font.id as any })}
                                            className={`
                                                py-3 px-2 flex flex-col items-center justify-center rounded-2xl border transition-all duration-200
                                                ${preferences.fontFamily === font.id 
                                                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 shadow-sm' 
                                                    : 'bg-gray-50 dark:bg-white/5 border-transparent hover:bg-gray-100 dark:hover:bg-white/10 hover:border-gray-200 dark:hover:border-white/20'
                                                }
                                            `}
                                        >
                                            <span className={`text-xl text-gray-900 dark:text-white mb-1 ${font.class}`}>Aa</span>
                                            <span className={`text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-white/60 ${font.class}`}>{font.label}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="w-full md:w-64 shrink-0 flex flex-col justify-center">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-semibold text-gray-500 dark:text-white/60 uppercase tracking-wider">Size</span>
                                    </div>
                                    <div className="relative h-10 bg-gray-100 dark:bg-white/5 rounded-xl p-1 flex items-center">
                                        {['small', 'medium', 'large'].map((size) => (
                                            <button
                                                key={size}
                                                onClick={() => onUpdatePreferences({ fontSize: size as any })}
                                                className={`
                                                    flex-1 h-full rounded-lg text-xs font-medium transition-all duration-200 z-10
                                                    ${preferences.fontSize === size ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-white/60'}
                                                `}
                                            >
                                                <span className="capitalize">{size}</span>
                                            </button>
                                        ))}
                                        <motion.div 
                                            className="absolute top-1 bottom-1 bg-white dark:bg-white/10 rounded-lg shadow-sm"
                                            initial={false}
                                            animate={{
                                                left: preferences.fontSize === 'small' ? '4px' : preferences.fontSize === 'medium' ? '33.33%' : '66.66%',
                                                width: 'calc(33.33% - 5px)',
                                                x: preferences.fontSize === 'medium' ? 2 : preferences.fontSize === 'large' ? 1 : 0
                                            }}
                                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        {/* --- SYSTEM CARD --- */}
                        <motion.div variants={itemVariants} className="col-span-1 border border-gray-200 dark:border-white/10 rounded-3xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow bg-red-50/20 dark:bg-red-900/10 flex flex-col justify-between">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-xl text-gray-600 dark:text-white/80">
                                    <Cpu className="w-4 h-4 sm:w-5 sm:h-5" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-gray-900 dark:text-white">System</h2>
                                </div>
                            </div>

                            <div className="flex flex-row gap-2 sm:gap-3">
                                <button 
                                    onClick={() => setIsApiKeyModalOpen(true)}
                                    className="flex-1 flex items-center justify-center py-2.5 px-3 rounded-2xl bg-gray-50 dark:bg-white/5 border border-transparent hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
                                >
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                        <Key className={`w-4 h-4 ${apiKey ? 'text-emerald-500' : 'text-gray-400'}`} />
                                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-white/80 whitespace-nowrap">
                                            {apiKey ? `••••${apiKey.slice(-4)}` : 'Setup API Key'}
                                        </span>
                                    </div>
                                </button>

                                <button 
                                    onClick={() => setIsResetConfirmOpen(true)}
                                    className="flex-1 flex items-center justify-center py-2.5 px-3 rounded-2xl bg-red-50/50 dark:bg-red-500/5 border border-transparent hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-100 dark:hover:border-red-500/20 transition-all text-red-600 dark:text-red-400"
                                >
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                        <Trash2 className="w-4 h-4" />
                                        <span className="text-xs sm:text-sm font-medium whitespace-nowrap">Reset App</span>
                                    </div>
                                </button>
                            </div>
                        </motion.div>

                    </div>
                    {/* Legal Footer for Public Verification */}
                    <footer className="mt-8 text-center border-t border-neutral-200 dark:border-neutral-800 pt-6 pb-0 text-xs text-neutral-500 dark:text-neutral-500">
                        <div className="flex items-center justify-center space-x-4 mb-2 font-mono">
                            <a href="/privacy" onClick={(e) => { e.preventDefault(); onNavigate('privacy-policy'); }} className="hover:text-neutral-800 dark:hover:text-neutral-300 transition-colors">
                                Privacy Policy
                            </a>
                            <span>•</span>
                            <a href="/about" onClick={(e) => { e.preventDefault(); onNavigate('about'); }} className="hover:text-neutral-800 dark:hover:text-neutral-300 transition-colors">
                                About
                            </a>
                            <span>•</span>
                            <a href="/terms" onClick={(e) => { e.preventDefault(); onNavigate('terms-of-service'); }} className="hover:text-neutral-800 dark:hover:text-neutral-300 transition-colors">
                                Terms of Service
                            </a>
                        </div>
                        <p className="font-mono">&copy; {new Date().getFullYear()} {metadata.name}. Crafted with ❤️</p>
                    </footer>

                </div>
            </motion.main>

            {/* Modals - Moved outside motion.main to prevent fixed positioning issues */}
            <ConfirmationModal 
                isOpen={isResetConfirmOpen}
                onClose={() => setIsResetConfirmOpen(false)}
                onConfirm={handleClearData}
                title="Reset Application Data?"
                message="This will clear your local preferences and view state. Your actual chat history stored in the cloud will be safe."
                confirmButtonText="Reset Data"
                confirmButtonVariant="danger"
            />

            <ApiKeyModal
                isOpen={isApiKeyModalOpen}
                onClose={() => setIsApiKeyModalOpen(false)}
                onSetApiKey={handleApiKeyUpdate}
                currentApiKey={apiKey}
            />
        </>
    );
};

export default SettingsView;
