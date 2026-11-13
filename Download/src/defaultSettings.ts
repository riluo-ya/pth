
export interface Settings {
    useZipFormat: boolean;
    includeInfoYml: boolean;
    disableDiscordNotifications: boolean;
    exportIllustrationType: 'full' | 'blur';
    /** 导出谱面时的数据格式转换（与上游一致） */
    chartFormatConversion: 'none' | 'rpe';
    /** RPE 转换时把 cut 事件合并为缓动事件，减小体积 */
    chartEasingFitting: boolean;
    useNewUi: boolean;
    advancedInfo: boolean;
    /** 可选的 GitHub PAT，用于提高资源仓库的请求限额（仅对 GitHub 直连生效） */
    githubToken: string;
    // New UI Sub-settings
    newUiAudioPreview: boolean;
    newUiAutoplayAudio: boolean;
    newUiAudioVolume: number;
    newUiLoopAudio: boolean;
    newUiBlur: boolean;
    newUiBackgroundParallax: boolean;
    newUiShowVisualizer: boolean;
    newUiVisualizerColor: string;
    newUiVisualizerHeight: number;
    newUiVisualizerOpacity: number;
    newUiSongSpecificEffects: boolean;
    bulkDownloadMode: boolean;
    // 分享卡片
    shareCardEnabled: boolean;
    shareCardBpm: boolean;
    shareCardJudgeLines: boolean;
    shareCardDuration: boolean;
    shareCardNoteCounts: boolean;
}

export const defaultSettings: Settings = {
    useZipFormat: false,
    includeInfoYml: true,
    disableDiscordNotifications: false,
    exportIllustrationType: 'full',
    chartFormatConversion: 'none',
    chartEasingFitting: true,
    useNewUi: true,
    advancedInfo: false,
    githubToken: '',
    newUiAudioPreview: false,
    // PTH 原本选歌即播放，这里保留该体验；关掉后播放器初始为暂停
    newUiAutoplayAudio: true,
    newUiAudioVolume: 1,
    newUiLoopAudio: true,
    newUiBlur: true,
    newUiBackgroundParallax: true,
    newUiShowVisualizer: true,
    newUiVisualizerColor: 'gray', // slate-200
    newUiVisualizerHeight: 60,
    newUiVisualizerOpacity: 60,
    newUiSongSpecificEffects: false,
    bulkDownloadMode: false,
    shareCardEnabled: true,
    shareCardBpm: true,
    shareCardJudgeLines: true,
    shareCardDuration: true,
    shareCardNoteCounts: true,
};
