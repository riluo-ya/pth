
import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { Settings, defaultSettings } from '../defaultSettings';
import { setGithubToken } from '../utils/githubAuth';

const SETTINGS_STORAGE_KEY = 'phigrosDownloader_settings_v2';

interface SettingsContextType {
    settings: Settings;
    setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<Settings>(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
            return storedSettings ? { ...defaultSettings, ...JSON.parse(storedSettings) } : defaultSettings;
        } catch (error) {
            console.error('Error reading settings from localStorage', error);
            return defaultSettings;
        }
    });

    // 与上游一致：在渲染阶段写入，保证任何子组件发出请求前 token 已就绪。
    // 只有 GitHub 直连的 URL 会带上它，jsDelivr / 代理源不会外泄。
    setGithubToken(settings.githubToken);

    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.error('Error saving settings to localStorage', error);
        }
    }, [settings]);

    return (
        <SettingsContext.Provider value={{ settings, setSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

// Provider 与配套 hook 同文件是 React Context 的常见写法，fast-refresh 规则在此不适用。
// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
