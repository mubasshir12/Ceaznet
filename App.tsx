
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, MoleculeData, VoiceName, UserProfile, NewsArticle, UserArticleInteraction, UIPreferences, Conversation } from './types';
import { initializeAiClient } from './services/aiClient';
import FloatingHeader from './components/FloatingHeader';
import ApiKeyModal from './components/ApiKeyModal';
import ViewRenderer from './components/ViewRenderer';
import { getSetting, saveSetting, getTranslatorUsage, saveTranslatorUsage, getLocalUserProfile, incrementStat, saveInteraction, getInteractions, getBookmarkCount, saveConversation } from './services/dbService';
import { uploadFileToTelegram } from './services/telegramStorage';
import { useAuth } from './hooks/useAuth';
import AuthModal from './components/AuthModal';
import ProfileModal from './components/ProfileModal';
import UpdatePasswordModal from './components/UpdatePasswordModal';
import { supabase } from './services/supabaseClient';
import { BroadcastPopup } from './components/BroadcastPopup';
import { SystemBanner } from './components/SystemBanner';
import { fetchNews } from './services/newsService';
import Sidebar from './components/Sidebar';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useToast } from './components/ToastSystem';

import { useLocation, useNavigate } from 'react-router-dom';

const allExploreCategories = ['technology', 'business', 'science', 'health', 'sports', 'entertainment'];
const UI_PREFS_KEY = 'kalina_ui_preferences';

const DEFAULT_UI_PREFS: UIPreferences = {
    fontSize: 'medium',
    fontFamily: 'sans',
    layoutDensity: 'comfortable',
    borderRadius: 'medium',
    showTimeBubble: true
};

// --- ROUTING HELPERS ---
const viewToPath: Record<View, string> = {
    'home': '/',
    'explore': '/explore',
    'article-reader': '/explore/reader',
    'notes': '/notes',
    'finance': '/finance',
    'dairy': '/dairy',
    'gallery': '/gallery',
    'translator': '/translator',
    'molecule-viewer': '/molecule',
    'live-conversation': '/live',
    'settings': '/settings',
    'about': '/about',
    'features': '/features',
    'privacy-policy': '/privacy-policy',
    'terms-of-service': '/terms-of-service',
    'voice-history': '/voice-history',
    'voice-settings': '/voice-settings',
    'support': '/support',
    'not-found': '/404'
};

const pathToView: Record<string, View> = Object.entries(viewToPath).reduce((acc, [view, path]) => {
    acc[path] = view as View;
    return acc;
}, {} as Record<string, View>);

const App: React.FC = () => {
    const { user, authEvent, logout } = useAuth();
    const networkStatus = useNetworkStatus();
    const { addToast } = useToast();
    const prevNetworkStatus = useRef(networkStatus);
    
    const location = useLocation();
    const navigate = useNavigate();

    const [isUpdatePasswordModalOpen, setIsUpdatePasswordModalOpen] = useState(false);

    useEffect(() => {
        if (authEvent === 'PASSWORD_RECOVERY') {
            setIsUpdatePasswordModalOpen(true);
        }
    }, [authEvent]);

    useEffect(() => {
        if (networkStatus.isOnline !== prevNetworkStatus.current.isOnline) {
            if (networkStatus.isOnline) {
                addToast("You're back online.", "success");
            } else {
                addToast("You are currently offline. Some features may be unavailable.", "warning");
            }
        }
        
        if (networkStatus.isSlow && !prevNetworkStatus.current.isSlow && networkStatus.isOnline) {
            addToast("Your network connection is very slow.", "info");
        }
        
        prevNetworkStatus.current = networkStatus;
    }, [networkStatus, addToast]);

    const [apiKey, setApiKey] = useState<string | null>(null);
    const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
    
    // Derived view from location
    const currentPath = location.pathname;
    const currentView = (() => {
        if (currentPath === '/' || currentPath === '/home') return 'home';
        if (currentPath.startsWith('/explore/reader')) return 'article-reader';
        if (currentPath.startsWith('/explore')) return 'explore';
        if (currentPath.startsWith('/notes')) return 'notes';
        if (currentPath.startsWith('/finance')) return 'finance';
        if (currentPath.startsWith('/dairy')) return 'dairy';
        if (currentPath.startsWith('/gallery')) return 'gallery';
        if (currentPath.startsWith('/translator')) return 'translator';
        if (currentPath.startsWith('/molecule')) return 'molecule-viewer';
        if (currentPath.startsWith('/live')) return 'live-conversation';
        if (currentPath.startsWith('/settings')) return 'settings';
        if (currentPath.startsWith('/about')) return 'about';
        if (currentPath.startsWith('/features')) return 'features';
        if (currentPath.startsWith('/privacy-policy')) return 'privacy-policy';
        if (currentPath.startsWith('/terms-of-service')) return 'terms-of-service';
        if (currentPath.startsWith('/voice-history')) return 'voice-history';
        if (currentPath.startsWith('/voice-settings')) return 'voice-settings';
        if (currentPath.startsWith('/support')) return 'support';
        return 'not-found' as View;
    })();
    
    const [previousView, setPreviousView] = useState<View | null>(null);
    const [lastPath, setLastPath] = useState(currentPath);

    useEffect(() => {
        if (currentPath !== lastPath) {
            // Calculate previous view
            let prevV: View = 'home';
            if (lastPath.startsWith('/explore/reader')) prevV = 'article-reader';
            else if (lastPath.startsWith('/explore')) prevV = 'explore';
            else if (lastPath.startsWith('/notes')) prevV = 'notes';
            else if (lastPath.startsWith('/finance')) prevV = 'finance';
            else if (lastPath.startsWith('/dairy')) prevV = 'dairy';
            else if (lastPath.startsWith('/gallery')) prevV = 'gallery';
            else if (lastPath.startsWith('/translator')) prevV = 'translator';
            else if (lastPath.startsWith('/molecule')) prevV = 'molecule-viewer';
            else if (lastPath.startsWith('/live')) prevV = 'live-conversation';
            else if (lastPath.startsWith('/settings')) prevV = 'settings';
            
            setPreviousView(prevV);
            setLastPath(currentPath);

            
            // Clear search queries when switching views
            setNotesSearchQuery('');
            setFinanceSearchQuery('');
            setVoiceHistorySearchQuery('');
        }
    }, [currentPath, lastPath]);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [notesSearchQuery, setNotesSearchQuery] = useState('');
    const [financeSearchQuery, setFinanceSearchQuery] = useState('');
    const [voiceHistorySearchQuery, setVoiceHistorySearchQuery] = useState('');
    
    const [uiPreferences, setUiPreferences] = useState<UIPreferences>(() => {
        try {
            const stored = localStorage.getItem(UI_PREFS_KEY);
            return stored ? { ...DEFAULT_UI_PREFS, ...JSON.parse(stored) } : DEFAULT_UI_PREFS;
        } catch {
            return DEFAULT_UI_PREFS;
        }
    });

    const handleNavigate = (view: View) => {
        const targetPath = viewToPath[view] || '/404';
        navigate(targetPath);
        setIsSidebarOpen(false);
    };

    const handleUpdatePreferences = (newPrefs: Partial<UIPreferences>) => {
        setUiPreferences(prev => {
            const updated = { ...prev, ...newPrefs };
            localStorage.setItem(UI_PREFS_KEY, JSON.stringify(updated));
            return updated;
        });
    };

    // Apply UI Preferences Effect
    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        if (uiPreferences.fontSize === 'small') root.style.fontSize = '13px';
        else if (uiPreferences.fontSize === 'large') root.style.fontSize = '16px';
        else root.style.fontSize = '14px';
        body.classList.remove('font-sans', 'font-serif', 'font-mono', 'font-inter', 'font-playfair', 'font-quicksand');
        body.classList.add(`font-${uiPreferences.fontFamily}`);
        if (uiPreferences.layoutDensity === 'compact') body.classList.add('layout-compact');
        else body.classList.remove('layout-compact');
        root.setAttribute('data-radius', uiPreferences.borderRadius || 'medium');
    }, [uiPreferences]);

    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [translatorUsage, setTranslatorUsage] = useState<{ input: number, output: number }>({ input: 0, output: 0 });
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });
    
    const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
        const root = document.documentElement;
        const lightHljs = document.getElementById('hljs-light-theme');
        const darkHljs = document.getElementById('hljs-dark-theme');
        if (newTheme === 'system') {
            localStorage.removeItem('theme');
            const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            setIsDarkMode(systemIsDark);
            root.classList.toggle('dark', systemIsDark);
            lightHljs?.toggleAttribute('disabled', systemIsDark);
            darkHljs?.toggleAttribute('disabled', !systemIsDark);
        } else {
            localStorage.setItem('theme', newTheme);
            const isDark = newTheme === 'dark';
            setIsDarkMode(isDark);
            root.classList.toggle('dark', isDark);
            lightHljs?.toggleAttribute('disabled', isDark);
            darkHljs?.toggleAttribute('disabled', !isDark);
        }
    };

    const [moleculeForFullScreen, setMoleculeForFullScreen] = useState<MoleculeData | null>(null);
    const [articleForReading, setArticleForReading] = useState<NewsArticle | null>(null);
    const [voiceModeVoice, setVoiceModeVoice] = useState<VoiceName>('Elara');
    const [voiceModePersonaInstruction, setVoiceModePersonaInstruction] = useState<string>('');
    const [voiceModeToneInstruction, setVoiceModeToneInstruction] = useState<string>('');
    const [voiceModeCustomInstruction, setVoiceModeCustomInstruction] = useState<string>('');
    const [isVoiceProactiveMode, setIsVoiceProactiveMode] = useState(true);
    const [isAudioRecordingEnabled, setIsAudioRecordingEnabled] = useState(true);
    const [voiceContinuationContext, setVoiceContinuationContext] = useState<string>('');
    const [exploreCurrentIndex, setExploreCurrentIndex] = useState(0);
    const [exploreActiveCategory, setExploreActiveCategory] = useState<string>('for-you');
    const [exploreArticles, setExploreArticles] = useState<NewsArticle[]>([]);
    const [exploreIsLoading, setExploreIsLoading] = useState(true);
    const [exploreError, setExploreError] = useState<string | null>(null);
    const [interactions, setInteractions] = useState<Record<string, UserArticleInteraction>>({});
    const [isBookmarkFeedOpen, setIsBookmarkFeedOpen] = useState(false);
    const [bookmarkCount, setBookmarkCount] = useState<number | null>(null);
    const [isVoiceConversationSaving, setIsVoiceConversationSaving] = useState(false);

    useEffect(() => {
        const parts = currentPath.split('/');
        if (parts.length >= 4 && parts[1] === 'explore' && parts[2] === 'reader') {
            const urlId = parts[3];
            try {
                const decodedUrl = atob(urlId.replace(/-/g, '+').replace(/_/g, '/'));
                
                // Only try to find if we have articles loaded
                if (exploreArticles.length > 0) {
                    const foundArticle = exploreArticles.find(a => a.url === decodedUrl);
                    if (foundArticle && articleForReading?.url !== decodedUrl) {
                        setArticleForReading(foundArticle);
                    } else if (!foundArticle && articleForReading?.url !== decodedUrl) {
                        // Needs to fetch the missing article by URL from DB if not in list
                        supabase
                            .from('public_news_articles')
                            .select('*')
                            .eq('article_data->>url', decodedUrl)
                            .single()
                            .then(({ data }) => {
                                if (data && data.article_data) {
                                    const art: NewsArticle = {
                                        ...(data.article_data as NewsArticle),
                                        category: data.category,
                                        formattedContent: data.formatted_content_md,
                                        views: data.views,
                                        likes: data.likes,
                                        bookmarks: data.bookmarks
                                    };
                                    setArticleForReading(art);
                                }
                            });
                    }
                }
            } catch (e) {
                console.error("Invalid base64 URL ID");
            }
        } else if (currentPath === '/explore' || (parts.length === 3 && parts[1] === 'explore')) {
             if (articleForReading) setArticleForReading(null);
             if (parts.length === 3) {
                 const category = parts[2];
                 if (exploreActiveCategory !== category) {
                     setExploreActiveCategory(category);
                 }
             }
        }
    }, [currentPath, exploreArticles]);

    const [galleryHeaderState, setGalleryHeaderState] = useState<{
        onUpload?: () => void;
        isUploading?: boolean;
    }>({});

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const getNewsForCategory = async (category: string) => {
            setExploreIsLoading(true);
            setExploreError(null);
            setExploreArticles([]);
            setExploreCurrentIndex(0);
            try {
                const fetchedArticles = await fetchNews(category);
                setExploreArticles(fetchedArticles);
            } catch (err: any) {
                setExploreError(err.message || 'An unknown error occurred.');
            } finally {
                setExploreIsLoading(false);
            }
        };
        const getNewsForAll = async () => {
            setExploreIsLoading(true);
            setExploreError(null);
            setExploreArticles([]);
            setExploreCurrentIndex(0);
            try {
                const promises = allExploreCategories.map(cat => fetchNews(cat));
                const results = await Promise.allSettled(promises);
                const successfulResults = results
                    .filter((res): res is PromiseFulfilledResult<NewsArticle[]> => res.status === 'fulfilled')
                    .map(res => res.value);
                const flattenedArticles = successfulResults.flat();
                const shuffled = flattenedArticles.sort(() => 0.5 - Math.random());
                setExploreArticles(shuffled);
            } catch (err: any) {
                setExploreError(err.message || 'An unknown error occurred while fetching all news.');
            } finally {
                setExploreIsLoading(false);
            }
        };
        if (exploreActiveCategory === 'for-you') getNewsForAll();
        else getNewsForCategory(exploreActiveCategory);
    }, [exploreActiveCategory]);

    const [userProfile, setUserProfile] = useState<UserProfile>({
        id: '',
        name: 'User',
        full_name: 'User',
        avatar_url: null
    });

    useEffect(() => {
        const fetchProfile = async () => {
            setIsProfileLoading(true);
            if (user) {
                try {
                    const { data, error, status } = await supabase
                        .from('profiles')
                        .select(`full_name, avatar_url`)
                        .eq('id', user.id)
                        .single();
                    if (error && status !== 406) throw error;
                    if (data) setUserProfile({ id: user.id, name: data.full_name, full_name: data.full_name, avatar_url: data.avatar_url });
                } catch (error: any) {
                    console.error('Error fetching user profile:', error);
                } finally {
                    setIsProfileLoading(false);
                }
            } else {
                getLocalUserProfile().then(localProfile => {
                    if (localProfile) setUserProfile(p => ({...p, ...localProfile}));
                }).catch(e => console.error("Failed to load local User Profile from DB", e))
                .finally(() => setIsProfileLoading(false));
            }
        };
        fetchProfile();
    }, [user?.id]);

    useEffect(() => {
        if (currentView !== 'molecule-viewer') setMoleculeForFullScreen(null);
        if (currentView !== 'article-reader') setArticleForReading(null);
    }, [currentView]);

    useEffect(() => {
        getTranslatorUsage(user).then(setTranslatorUsage).catch(e => console.error("Failed to load translator usage", e));
    }, [user?.id]);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [storedVoice, storedPersona, storedTone, storedCustom, storedProactive] = await Promise.all([
                    getSetting<VoiceName>('kalina_voice_mode_voice', user),
                    getSetting<string>('kalina_voice_mode_persona_instruction', user),
                    getSetting<string>('kalina_voice_mode_tone_instruction', user),
                    getSetting<string>('kalina_voice_mode_custom_instruction', user),
                    getSetting<boolean>('kalina_voice_proactive_mode', user)
                ]);
                if (storedVoice) setVoiceModeVoice(storedVoice);
                if (storedPersona) setVoiceModePersonaInstruction(storedPersona);
                if (storedTone) setVoiceModeToneInstruction(storedTone);
                if (storedCustom) setVoiceModeCustomInstruction(storedCustom);
                if (storedProactive !== undefined) setIsVoiceProactiveMode(storedProactive);
            } catch (e) {
                console.error("Failed to load settings", e);
            }
        };
        loadSettings();
    }, [user?.id]);

    useEffect(() => {
        getSetting<string>('kalina_api_key', user).then(storedApiKey => {
            if (storedApiKey) {
                try {
                    initializeAiClient(storedApiKey);
                    setApiKey(storedApiKey);
                } catch (e) {
                    console.error("Failed to initialize API key", e);
                }
            }
        });
        
        const handleRequestApiKey = () => setIsApiKeyModalOpen(true);
        const handleUpdateApiKey = (e: Event) => {
            const key = (e as CustomEvent).detail;
            handleSetApiKey(key);
        };
        
        window.addEventListener('request-api-key', handleRequestApiKey);
        window.addEventListener('update-api-key', handleUpdateApiKey);
        
        return () => {
            window.removeEventListener('request-api-key', handleRequestApiKey);
            window.removeEventListener('update-api-key', handleUpdateApiKey);
        };
    }, [user?.id]);

    useEffect(() => {
        const fetchInteractions = async () => {
            if (exploreArticles.length > 0) {
                const urls = exploreArticles.map(a => a.url);
                const interactionsList = await getInteractions(user, urls);
                const interactionsMap = interactionsList.reduce((acc, curr) => {
                    acc[curr.article_url] = curr;
                    return acc;
                }, {} as Record<string, UserArticleInteraction>);
                setInteractions(prev => {
                    const merged = { ...prev, ...interactionsMap };
                    if (JSON.stringify(prev) === JSON.stringify(merged)) return prev;
                    return merged;
                });
            }
        };
        fetchInteractions();
    }, [exploreArticles, user?.id]);

    // Calculate interactions string signature to prevent infinite deep render loops
    const interactionsSignature = useMemo(() => {
        return Object.entries(interactions)
            .filter(([_, val]) => val.bookmarked)
            .map(([key]) => key)
            .sort()
            .join(',');
    }, [interactions]);

    useEffect(() => {
        const fetchBookmarkCount = async () => {
            const count = await getBookmarkCount(user);
            setBookmarkCount(count);
        };
        fetchBookmarkCount();
    }, [user?.id, interactionsSignature]); // Re-fetch only when bookmarked items change

    const handleArticleUpdate = useCallback((updatedArticle: NewsArticle) => {
        setExploreArticles(prev => prev.map(art => art.url === updatedArticle.url ? updatedArticle : art));
        if (articleForReading && articleForReading.url === updatedArticle.url) {
            setArticleForReading(updatedArticle);
        }
    }, [articleForReading]);

    const handleSetApiKey = (key: string) => {
        initializeAiClient(key);
        saveSetting('kalina_api_key', key, user);
        setApiKey(key);
        setIsApiKeyModalOpen(false);
    };

    const handleInteraction = useCallback((articleUrl: string, type: 'like' | 'bookmark') => {
        const key = type === 'like' ? 'liked' : 'bookmarked';
        const isCurrentlyActive = interactions[articleUrl]?.[key] ?? false;
        const newState = !isCurrentlyActive;
        
        if (type === 'bookmark') setBookmarkCount(prev => (prev !== null ? (newState ? prev + 1 : Math.max(0, prev - 1)) : null));
        
        // Update interaction state
        setInteractions(prev => ({...prev, [articleUrl]: { ...(prev[articleUrl] || { article_url: articleUrl, liked: false, bookmarked: false }), [key]: newState }}));
        
        // Update list of articles in Explore view
        setExploreArticles(prev => prev.map(art => art.url === articleUrl ? { ...art, [type === 'like' ? 'likes' : 'bookmarks']: (art[type === 'like' ? 'likes' : 'bookmarks'] || 0) + (newState ? 1 : -1) } : art));
        
        // Update current reading article if it matches
        if (articleForReading && articleForReading.url === articleUrl) {
            setArticleForReading(prev => prev ? ({
                ...prev,
                [type === 'like' ? 'likes' : 'bookmarks']: (prev[type === 'like' ? 'likes' : 'bookmarks'] || 0) + (newState ? 1 : -1)
            }) : null);
        }

        saveInteraction(user, { ...(interactions[articleUrl] || { article_url: articleUrl, liked: false, bookmarked: false }), [key]: newState });
        incrementStat(articleUrl, type === 'like' ? 'likes' : 'bookmarks', newState);
    }, [interactions, user, articleForReading]);

    const handleSaveVoiceConversation = useCallback(async (transcript: any[], audioBlob?: Blob) => {
        if (!transcript || transcript.length === 0) return;
        
        setIsVoiceConversationSaving(true);
        try {
            // Generate a title based on the first user message or default
            const firstUserMsg = transcript.find(t => t.role === 'user');
            const title = firstUserMsg ? (firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '')) : 'Voice Conversation';
            
            const conversationId = crypto.randomUUID();
            const newConvo: Conversation = {
                id: conversationId,
                user_id: user?.id,
                title: title,
                messages: transcript,
                createdAt: new Date().toISOString(),
                isVoiceConversation: true,
                audio_url: null
            };

            // Save initial state
            await saveConversation(newConvo, user);

            // Upload audio in the background so we don't block the UI
            if (audioBlob) {
                uploadFileToTelegram(audioBlob).then(async (audioUrl) => {
                    if (audioUrl) {
                        const updatedConvo = { ...newConvo, audio_url: audioUrl };
                        // Update DB
                        await saveConversation(updatedConvo, user);
                    }
                }).catch(err => {
                    console.error('Unexpected error uploading audio to Telegram:', err);
                });
            }
        } finally {
            setIsVoiceConversationSaving(false);
        }
    }, [user]);

    const handleTranslationComplete = useCallback((t: { input: number, output: number }) => {
        setTranslatorUsage(prev => {
            const newUsage = { input: prev.input + t.input, output: prev.output + t.output };
            saveTranslatorUsage(newUsage, user).catch(e => console.error("Failed to save translator usage", e));
            return newUsage;
        });
    }, [user]);

    const [dairyHeaderState, setDairyHeaderState] = useState<{ 
        title: string | null; 
        onBack?: () => void; 
        onDelete?: () => void;
        onEdit?: () => void;
        onImport?: () => void;
        onExport?: () => void;
    }>({ title: null });

    const [notesHeaderState, setNotesHeaderState] = useState<{
        title: string | null;
        isReadOnly: boolean;
        isWalletLinked: boolean;
        isSyncing: boolean;
        onBack?: () => void;
        onEdit?: () => void;
        onSave?: () => void;
        onSync?: () => void;
    }>({ title: null, isReadOnly: false, isWalletLinked: false, isSyncing: false });

    const [supportHeaderState, setSupportHeaderState] = useState<{
        title: string | null;
        onBack?: () => void;
    }>({ title: null });

    return (
        <>
            {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-40 md:hidden" />}
            <div className="flex flex-col h-full bg-[#F9F6F2] dark:bg-black text-neutral-800 dark:text-white transition-colors duration-300">
                <div className="flex-none w-full">
                    <SystemBanner key={`banner-${user?.id || 'guest'}`} />
                </div>
                <div className="flex flex-1 overflow-hidden relative">
                    <Sidebar 
                        isMobileOpen={isSidebarOpen}
                        onMobileClose={() => setIsSidebarOpen(false)}
                        currentView={currentView}
                        onNavigate={handleNavigate}
                    />
                    
                    <div className="flex-1 flex flex-col overflow-hidden relative">
                        {!['live-conversation', 'not-found'].includes(currentView) && (
                        <FloatingHeader
                            onOpenSidebar={() => setIsSidebarOpen(true)}
                            user={user}
                            userProfile={userProfile}
                            onOpenAuthModal={() => setIsAuthModalOpen(true)}
                            onOpenProfileModal={() => setIsProfileModalOpen(true)}
                            onLogout={logout}
                            onNavigate={handleNavigate}
                            currentView={currentView}
                            previousView={previousView}
                            bookmarkCount={bookmarkCount}
                            onOpenBookmarks={() => setIsBookmarkFeedOpen(true)}
                            isProfileLoading={isProfileLoading}
                            notesSearchQuery={notesSearchQuery}
                            setNotesSearchQuery={setNotesSearchQuery}
                            financeSearchQuery={financeSearchQuery}
                            setFinanceSearchQuery={setFinanceSearchQuery}
                            voiceHistorySearchQuery={voiceHistorySearchQuery}
                            setVoiceHistorySearchQuery={setVoiceHistorySearchQuery}
                            articleTitle={articleForReading?.title}
                            articleLikes={articleForReading?.likes}
                            articleViews={articleForReading?.views}
                            dairyTitle={dairyHeaderState.title}
                            onDairyBack={dairyHeaderState.onBack}
                            onDairyDelete={dairyHeaderState.onDelete}
                            onDairyEdit={dairyHeaderState.onEdit}
                            onDairyImport={dairyHeaderState.onImport}
                            onDairyExport={dairyHeaderState.onExport}
                            notesHeaderState={notesHeaderState}
                            onGalleryUpload={galleryHeaderState.onUpload}
                            isGalleryUploading={galleryHeaderState.isUploading}
                            uiPreferences={uiPreferences}
                            supportHeaderState={supportHeaderState}
                        />
                    )}

                    <div ref={scrollContainerRef} className={`flex-1 min-h-0 scrollbar-hide ${currentView === 'not-found' ? 'flex flex-col overflow-hidden' : (['live-conversation', 'reading', 'explore', 'article-reader', 'settings', 'finance', 'notes', 'about', 'features', 'privacy-policy', 'terms-of-service', 'molecule-viewer', 'gallery'].includes(currentView) ? 'overflow-hidden' : 'overflow-y-auto')}`}>
                        <ViewRenderer
                            currentView={currentView}
                            setCurrentView={handleNavigate}
                            translatorUsage={translatorUsage}
                            scrollContainerRef={scrollContainerRef}
                            onCloseTranslator={() => handleNavigate('home')}
                            onTranslationComplete={handleTranslationComplete}
                            moleculeForFullScreen={moleculeForFullScreen}
                            onMaximizeMoleculeViewer={setMoleculeForFullScreen}
                            voiceModeVoice={voiceModeVoice}
                            setVoiceModeVoice={setVoiceModeVoice}
                            voiceModePersonaInstruction={voiceModePersonaInstruction}
                            setVoiceModePersonaInstruction={setVoiceModePersonaInstruction}
                            voiceModeToneInstruction={voiceModeToneInstruction}
                            setVoiceModeToneInstruction={setVoiceModeToneInstruction}
                            voiceModeCustomInstruction={voiceModeCustomInstruction}
                            setVoiceModeCustomInstruction={setVoiceModeCustomInstruction}
                            isVoiceProactiveMode={isVoiceProactiveMode}
                            setIsVoiceProactiveMode={setIsVoiceProactiveMode}
                            onBackFromLive={() => handleNavigate('home')}
                            onSaveVoiceConversation={handleSaveVoiceConversation}
                            voiceContinuationContext={voiceContinuationContext}
                            user={user}
                            userProfile={userProfile}
                            onReadArticle={a => { 
                                setArticleForReading(a); 
                                const id = btoa(a.url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                                navigate('/explore/reader/' + id); 
                            }}
                            articleForReading={articleForReading}
                            exploreCurrentIndex={exploreCurrentIndex}
                            setExploreCurrentIndex={setExploreCurrentIndex}
                            exploreActiveCategory={exploreActiveCategory}
                            setExploreActiveCategory={setExploreActiveCategory}
                            exploreArticles={exploreArticles}
                            setExploreArticles={setExploreArticles}
                            exploreIsLoading={exploreIsLoading}
                            exploreError={exploreError}
                            interactions={interactions}
                            handleInteraction={handleInteraction}
                            isBookmarkFeedOpen={isBookmarkFeedOpen}
                            setIsBookmarkFeedOpen={setIsBookmarkFeedOpen}
                            bookmarkCount={bookmarkCount}
                            uiPreferences={uiPreferences}
                            onUpdatePreferences={handleUpdatePreferences}
                            currentTheme={isDarkMode ? 'dark' : 'light'}
                            onThemeChange={handleThemeChange}
                            notesSearchQuery={notesSearchQuery}
                            setNotesSearchQuery={setNotesSearchQuery}
                            financeSearchQuery={financeSearchQuery}
                            voiceHistorySearchQuery={voiceHistorySearchQuery}
                            isVoiceConversationSaving={isVoiceConversationSaving}
                            isAudioRecordingEnabled={isAudioRecordingEnabled}
                            setIsAudioRecordingEnabled={setIsAudioRecordingEnabled}
                            onArticleUpdate={handleArticleUpdate}
                            onEditProfile={() => setIsProfileModalOpen(true)}
                            previousView={previousView}
                            onOpenSidebar={() => setIsSidebarOpen(true)}
                            onLogout={logout}
                            onOpenAuthModal={() => setIsAuthModalOpen(true)}
                            setDairyHeaderState={setDairyHeaderState}
                            setNotesHeaderState={setNotesHeaderState}
                            setGalleryHeaderState={setGalleryHeaderState}
                            setSupportHeaderState={setSupportHeaderState}
                        />
                    </div>
                </div>
                </div>
            </div>
            
            <ApiKeyModal isOpen={isApiKeyModalOpen} onSetApiKey={handleSetApiKey} onClose={() => setIsApiKeyModalOpen(false)} currentApiKey={apiKey} />
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            {user && <ProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} user={user} userProfile={userProfile} onProfileUpdate={p => setUserProfile(prev => ({...prev, ...p}))} />}
            <UpdatePasswordModal isOpen={isUpdatePasswordModalOpen} onClose={() => setIsUpdatePasswordModalOpen(false)} />
            <BroadcastPopup key={`broadcast-${user?.id || 'guest'}`} />
        </>
    );
};

export default App;
