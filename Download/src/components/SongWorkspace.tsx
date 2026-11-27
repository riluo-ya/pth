import React, { useEffect, useRef, useState } from 'react';
import { Song, FileInfo } from '../types';
import { Spinner } from './Spinner';
import { DifficultySelector } from './DifficultySelector';
import { FileTable } from './FileTable';
import { AudioPlayerControl } from './AudioPlayerControl';
import { ArrowDownTrayIcon, ChevronDownIcon, PhotoIcon } from './Icons';
import { useSettings } from '../contexts/SettingsContext';

export interface ExportState {
    type: 'phira' | 'chart' | null;
    progress: number;
}

interface SongWorkspaceProps {
    song: Song | null;
    bgImage: string | null;
    isBgLoaded: boolean;
    audio: HTMLAudioElement | null;
    files: FileInfo[];
    isLoadingFiles: boolean;
    difficulties: string[];
    selectedDifficulty: string | null;
    onSelectDifficulty: (difficulty: string) => void;
    exportState: ExportState;
    onExportChart: () => void;
    onExportAllAssets: () => void;
    /** 传入后才显示「生成分享卡片」入口 */
    onShareCardClick?: () => void;
    /** PTH 的 FileTable 内部自己加载文件，加载完成后回调这里 */
    onFilesFound: (files: FileInfo[]) => void;
}

// How far (px) the file list has to scroll before the illustration is fully dimmed.
const DIM_DISTANCE = 320;
const MAX_DIM = 0.82;
// Max distance (px) the illustration drifts from centre while following the pointer. Must stay below the -inset-6 bleed.
const PARALLAX_SHIFT = 14;

const ProgressBar: React.FC<{ progress: number; className: string }> = ({ progress, className }) => (
    <div className={`absolute bottom-0 left-0 h-[3px] transition-[width] duration-150 ${className}`} style={{ width: `${progress.toFixed(0)}%` }} />
);

export const SongWorkspace: React.FC<SongWorkspaceProps> = ({
    song,
    bgImage,
    isBgLoaded,
    audio,
    files,
    isLoadingFiles,
    difficulties,
    selectedDifficulty,
    onSelectDifficulty,
    exportState,
    onExportChart,
    onExportAllAssets,
    onShareCardClick,
    onFilesFound,
}) => {
    const { settings } = useSettings();
    const [scrollTop, setScrollTop] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const parallaxRef = useRef<HTMLDivElement>(null);
    const parallaxEnabled = settings.newUiBackgroundParallax;

    // Jump back to the workspace when switching songs.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 });
    }, [song?.id]);

    // 曲绘随鼠标轻微漂移。仅鼠标/触控板，遵循「减少动态效果」偏好。
    useEffect(() => {
        const el = parallaxRef.current;
        if (!el) return;
        el.style.transform = '';
        if (!parallaxEnabled) return;
        const mql = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
        if (!mql.matches) return;

        let targetX = 0, targetY = 0, x = 0, y = 0, frame = 0;
        const tick = () => {
            x += (targetX - x) * 0.08;
            y += (targetY - y) * 0.08;
            el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
            frame = Math.abs(targetX - x) > 0.05 || Math.abs(targetY - y) > 0.05 ? requestAnimationFrame(tick) : 0;
        };
        const handleMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            targetX = (e.clientX / window.innerWidth - 0.5) * -2 * PARALLAX_SHIFT;
            targetY = (e.clientY / window.innerHeight - 0.5) * -2 * PARALLAX_SHIFT;
            if (!frame) frame = requestAnimationFrame(tick);
        };
        const handleLeave = () => {
            targetX = targetY = 0;
            if (!frame) frame = requestAnimationFrame(tick);
        };
        window.addEventListener('pointermove', handleMove);
        document.documentElement.addEventListener('pointerleave', handleLeave);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            document.documentElement.removeEventListener('pointerleave', handleLeave);
            cancelAnimationFrame(frame);
        };
    }, [parallaxEnabled]);

    const scrollToFiles = () => {
        const el = scrollRef.current;
        el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    const isExporting =exportState.type !== null;
    const dim = Math.min(scrollTop / DIM_DISTANCE, 1) * MAX_DIM;

    return (
        <div className="relative h-full min-h-0 overflow-hidden">
            {/* Illustration layer — 清晰大图，随鼠标轻微漂移（与上游一致） */}
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,#141b29_0_10px,#0f1521_10px_20px)]" />
            <div ref={parallaxRef} className="absolute -inset-6 will-change-transform" aria-hidden="true">
                <div
                    className="absolute inset-0 bg-cover bg-center transition-[opacity,transform] duration-700 ease-out"
                    style={{
                        backgroundImage: bgImage ? `url("${bgImage}")` : 'none',
                        opacity: isBgLoaded ? 1 : 0,
                        transform: isBgLoaded ? 'scale(1)' : 'scale(1.04)',
                    }}
                />
            </div>
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_bottom,rgba(9,11,16,0)_15%,rgba(9,11,16,.7)_50%,#090b10_82%)]" />
            <div className="absolute inset-0 pointer-events-none bg-[#090b10]" style={{ opacity: dim }} />

            <div
                ref={scrollRef}
                onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
                className="absolute inset-0 overflow-y-auto thin-scroll"
            >
                {!song ? (
                    <div className="min-h-full flex flex-col justify-end gap-2 px-5 sm:px-10 pb-12">
                        <span className="font-mono text-[11px] font-medium tracking-[.12em] text-[#22d3ee]">未选择曲目</span>
                        <span className="text-[32px] sm:text-[52px] font-bold leading-[1.15] tracking-[-0.01em] text-white">挑一首曲子</span>
                        <span className="text-base text-slate-400">从左侧列表里选一首，即可查看它的谱面与资源文件。</span>
                    </div>
                ) : (
                    <>
                        <div className="min-h-full flex flex-col justify-end gap-5 px-5 sm:px-10 pt-10">
                            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 lg:gap-6">
                                <div className="flex flex-col gap-1 min-w-0">
                                    <span className="font-mono text-[11px] font-medium tracking-[.12em] text-[#22d3ee] break-all select-all" title="曲目 ID">{song.id}</span>
                                    <h2 className="text-[32px] sm:text-[52px] font-bold leading-[1.15] tracking-[-0.01em] text-white break-words">{song.name}</h2>
                                    <span className="text-base text-slate-400">{song.composer}</span>
                                </div>
                                {settings.newUiAudioPreview && audio && (
                                    <div className="self-start lg:self-auto">
                                        <AudioPlayerControl audio={audio} />
                                    </div>
                                )}
                            </div>

                            {isLoadingFiles ? (
                                <div className="flex flex-col gap-2.5">
                                    <span className="font-mono text-[10px] font-medium tracking-[.14em] text-slate-500">正在读取难度…</span>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        {[0, 1, 2, 3].map(i => (
                                            <div key={i} className="h-[56px] rounded-[10px] border border-white/[.06] bg-white/[.015] animate-pulse" />
                                        ))}
                                    </div>
                                </div>
                            ) : difficulties.length > 0 ? (
                                <DifficultySelector
                                    difficulties={difficulties}
                                    selectedDifficulty={selectedDifficulty}
                                    onSelectDifficulty={onSelectDifficulty}
                                    selectedSong={song}
                                />
                            ) : (
                                <p className="text-sm text-slate-500">没有找到这首曲子的谱面。</p>
                            )}

                            <div className="flex flex-col sm:flex-row gap-2.5">
                                <button
                                    type="button"
                                    onClick={onExportChart}
                                    disabled={isExporting || !selectedDifficulty}
                                    title="导出当前选中难度的谱面包"
                                    className="export-glow relative overflow-hidden flex-1 h-[52px] rounded-[10px] bg-[#22d3ee] hover:bg-[#67e8f9] text-[#06141a] flex items-center justify-center gap-2.5 font-bold text-[15px] tracking-[.04em] transition-colors disabled:cursor-not-allowed disabled:bg-[#22d3ee]/40 disabled:hover:bg-[#22d3ee]/40"
                                >
                                    {exportState.type === 'chart' ? (
                                        <>
                                            <span className="[&_svg]:text-[#06141a]"><Spinner /></span>
                                            正在导出…
                                        </>
                                    ) : (
                                        <>
                                            <ArrowDownTrayIcon className="w-[18px] h-[18px] [stroke-width:2]" />
                                            导出 [{selectedDifficulty ?? ''}] 谱面（Phira / RPE）
                                        </>
                                    )}
                                    {exportState.type === 'chart' && <ProgressBar progress={exportState.progress} className="bg-[#06141a]/40" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={onExportAllAssets}
                                    disabled={isExporting || files.length === 0}
                                    className="relative overflow-hidden h-[52px] px-5 rounded-[10px] border border-white/[.12] text-slate-200 flex items-center justify-center gap-2.5 font-semibold text-sm backdrop-blur-sm hover:bg-white/[.04] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {exportState.type === 'phira' ? <><Spinner />正在压缩…</> : '全部资源 .zip'}
                                    {exportState.type === 'phira' && <ProgressBar progress={exportState.progress} className="bg-[#22d3ee]/75" />}
                                </button>
                            </div>

                            {onShareCardClick && (
                                <div className="flex">
                                    <button
                                        type="button"
                                        onClick={onShareCardClick}
                                        className="h-10 px-4 rounded-[10px] border border-white/[.12] text-[13px] font-semibold text-slate-300 hover:bg-white/[.04] hover:text-white transition-colors flex items-center gap-2"
                                    >
                                        <PhotoIcon className="w-4 h-4" />
                                        生成分享卡片
                                    </button>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={scrollToFiles}
                                className="flex items-center justify-center gap-2 h-12 border-t border-white/[.06] text-[13px] text-slate-400 hover:text-slate-200 transition-colors"
                            >
                                <ChevronDownIcon className="w-3.5 h-3.5 [stroke-width:2]" />
                                向下滚动查看单个文件
                                <ChevronDownIcon className="w-3.5 h-3.5 [stroke-width:2]" />
                            </button>
                        </div>

                        <div className="px-5 sm:px-10 pt-1 pb-10">
                            <FileTable selectedSong={song} onFilesFound={onFilesFound} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
