import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { X, LoaderCircle, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useToast } from './ToastSystem';

interface UpdatePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const UpdatePasswordModal: React.FC<UpdatePasswordModalProps> = ({ isOpen, onClose }) => {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            addToast('Password updated successfully!', 'success');
            setTimeout(() => {
                onClose();
            }, 500);
        } catch (err: any) {
            const errorMsg = err.error_description || err.message;
            setError(errorMsg);
            addToast(errorMsg, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[#0a0a0a]/60 dark:bg-black/80 backdrop-blur-xl transition-opacity" onClick={loading ? undefined : onClose} />
            <div className="relative w-full max-w-[400px] bg-white/90 dark:bg-black backdrop-blur-2xl rounded-[1.9rem] shadow-2xl border border-white/20 dark:border-white/10 overflow-hidden transform transition-all duration-500 scale-100 opacity-100">
                <button onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full text-neutral-400 hover:text-neutral-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors z-20">
                    <X className="h-5 w-5" />
                </button>
                <div className="px-8 pt-10 pb-8">
                    <div className="text-center mb-8 relative z-10">
                        <h2 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">Update Password</h2>
                        <p className="text-sm text-neutral-500 dark:text-gray-400 mt-2 font-medium">Please enter your new password.</p>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
                        <div className="group relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-gray-500 group-focus-within:text-amber-500 transition-colors">
                                <Lock className="h-5 w-5" />
                            </div>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="New Password"
                                className="w-full bg-neutral-50 dark:bg-black border border-neutral-200 dark:border-white/10 rounded-full py-3.5 pl-12 pr-12 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all shadow-sm"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        {error && (
                            <div className="flex items-center gap-2 text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30 animate-fade-in-up font-medium">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                {error}
                            </div>
                        )}
                        <button type="submit" disabled={loading} className="group relative w-full flex items-center justify-center gap-2 py-4 bg-neutral-900 dark:bg-white text-white dark:text-black font-bold rounded-full overflow-hidden transition-all hover:shadow-xl hover:shadow-amber-500/20 active:scale-[0.98] disabled:opacity-70 mt-2">
                            {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <><span>Update Password</span><ArrowRight className="w-4 h-4" /></>}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};
export default UpdatePasswordModal;
