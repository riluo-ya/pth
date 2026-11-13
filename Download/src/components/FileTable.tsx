
import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from './Spinner';
import { AssetDownloadWarningPopup } from './AssetDownloadWarningPopup';
import { Song, FileInfo } from '../types';
import { probeUrl, sendAssetDownloadNotification } from '../utils/api';
import { ghRaw } from '../utils/sources';
import { resourceFetch } from '../utils/githubAuth';
import { DIFFICULTY_ORDER } from '../utils/difficulty';
import { hasPerDifficultyIllustrations, ILLUSTRATION_DIFFICULTIES } from '../utils/resourceUrls';
import { getExtraCharts } from '../extraCharts';
import { useResourceError } from '../contexts/ResourceErrorContext';
import { ArrowDownTrayIcon, AudioIcon, DocumentTextIcon, PhotoIcon, InformationCircleIcon } from './Icons';
import { useSettings } from '../contexts/SettingsContext';

interface FileTableProps {
    selectedSong: Song | null;
    onFilesFound: (files: FileInfo[]) => void;
}

// 与上游一致的分辨率标注（原表格写在 getResolution 里，这里沿用同一套值）
const RESOLUTIONS: Record<string, string> = {
    'Illustration': '2048×1080',
    'Illustration (Low-Res)': '512×270',
    'Illustration (Blur)': '256×135',
};

const formatBytes = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const getDownloadName = (file: FileInfo, song: Song) =>
    file.type.startsWith('Chart') ? `Chart_${song.id}_${file.name}` : file.name;

export const FileTable: React.FC<FileTableProps> = ({ selectedSong, onFilesFound }) => {
    const { settings } = useSettings();
    const { reportResourceError } = useResourceError();
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

    // New state for warning popup
    const [showAssetWarning, setShowAssetWarning] = useState(false);
    const [pendingDownload, setPendingDownload] = useState<{ file: FileInfo; name: string } | null>(null);

    const executeDownload = useCallback(async (file: FileInfo, downloadName: string) => {
        if (downloadingUrl || !selectedSong) return; // Prevent multiple concurrent downloads
        setDownloadingUrl(file.url);
        try {
            const response = await resourceFetch(file.url, { referrerPolicy: 'no-referrer' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = downloadName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);

            if (!settings.disableDiscordNotifications) {
                sendAssetDownloadNotification(selectedSong.name, file.type);
            }
        } catch (error) {
            console.error('Download failed:', error);
            // 与上游一致：下载失败给出可见的资源错误弹窗（可重试 / 切换加速源）
            reportResourceError(
                `下载「${file.name}」失败。`,
                () => executeDownload(file, downloadName),
                error instanceof Error ? error.message : String(error)
            );
        } finally {
            setDownloadingUrl(null);
        }
    }, [downloadingUrl, selectedSong, settings.disableDiscordNotifications, reportResourceError]);

    const handleDownloadClick = (file: FileInfo) => {
        if (!selectedSong) return;

        const downloadName = getDownloadName(file, selectedSong);

        // Check for chart file and show warning if needed
        if (file.type.startsWith('Chart')) {
            const warningShown = localStorage.getItem('phigrosDownloader_assetWarningShown');
            if (!warningShown) {
                setPendingDownload({ file, name: downloadName });
                setShowAssetWarning(true);
                return;
            }
        }

        executeDownload(file, downloadName);
    };

    const handleWarningConfirm = () => {
        localStorage.setItem('phigrosDownloader_assetWarningShown', 'true');
        setShowAssetWarning(false);
        if (pendingDownload) {
            executeDownload(pendingDownload.file, pendingDownload.name);
            setPendingDownload(null);
        }
    };

    const handleWarningCancel = () => {
        setShowAssetWarning(false);
        setPendingDownload(null);
    };

    useEffect(() => {
        if (!selectedSong) {
            setFiles([]);
            onFilesFound([]);
            return;
        }

        const abortController = new AbortController();

        const fetchFiles = async () => {
            setIsLoading(true);
            setFiles([]);
            onFilesFound([]);
            const songId = selectedSong.id;

            const filesToFind: Promise<FileInfo | null>[] = [];

            // 与上游一致：HEAD 探测同时带回文件大小；已知存在的谱面只补一个体积，
            // 就算探测失败也保留该条目，不至于把整张表清空。
            const probe = async (file: FileInfo): Promise<FileInfo | null> => {
                if (abortController.signal.aborted) return null;
                const { exists, size } = await probeUrl(file.url);
                return exists ? { ...file, size: size ?? undefined } : null;
            };
            const withSize = async (file: FileInfo): Promise<FileInfo> => {
                if (abortController.signal.aborted) return file;
                const { size } = await probeUrl(file.url);
                return { ...file, size: size ?? undefined };
            };
            const branch = (name: string) => ghRaw(`7aGiven/Phigros_Resource/refs/heads/${name}`);

            // 主曲绘
            filesToFind.push(probe({
                type: 'Illustration', name: `${songId}.png`,
                url: branch(`illustration/${songId}.png`),
            }));

            // 少数歌曲每个难度各有一张曲绘（上游特有数据，PTH 之前漏了）
            if (hasPerDifficultyIllustrations(songId)) {
                ILLUSTRATION_DIFFICULTIES.forEach(diff => {
                    filesToFind.push(probe({
                        type: `Illustration (${diff})`, name: `${songId}_${diff}.png`,
                        url: branch(`illustration/${songId}_${diff}.png`),
                    }));
                });
            }

            // 低清 / 模糊曲绘
            filesToFind.push(probe({
                type: 'Illustration (Low-Res)', name: `${songId}.png`,
                url: branch(`illustrationLowRes/${songId}.png`),
            }));
            filesToFind.push(probe({
                type: 'Illustration (Blur)', name: `${songId}.png`,
                url: branch(`illustrationBlur/${songId}.png`),
            }));

            // 音频
            filesToFind.push(probe({
                type: 'Audio', name: `${songId}.ogg`,
                url: branch(`music/${songId}.ogg`),
            }));

            // 四个标准难度的谱面：有难度表时直接列出，没有才逐个探测
            DIFFICULTY_ORDER.forEach(diff => {
                const file: FileInfo = {
                    type: `Chart (${diff})`,
                    name: `${diff}.json`,
                    url: branch(`chart/${songId}.0/${diff}.json`),
                };
                if (!selectedSong.difficulties) {
                    filesToFind.push(probe(file));
                } else if (selectedSong.difficulties[diff]) {
                    filesToFind.push(withSize(file));
                }
            });

            // 难度表里没有、但实际存在的额外谱面（如第九章 SP）
            getExtraCharts(songId).forEach(extra => {
                const fileName = `${extra.difficulty}.json`;
                filesToFind.push(withSize({
                    type: `Chart (${extra.difficulty})`,
                    name: fileName,
                    url: branch(`chart/${songId}.0/${fileName}`),
                    tooltip: extra.tooltip,
                }));
            });

            try {
                const results = await Promise.all(filesToFind);
                if (abortController.signal.aborted) return;

                const foundFiles = results.filter((file): file is FileInfo => file !== null);

                onFilesFound(foundFiles);
                setFiles(foundFiles);
            } catch (error) {
                if (!abortController.signal.aborted) {
                    console.error('Error fetching files:', error);
                }
            } finally {
                if (!abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };

        fetchFiles();

        return () => {
            abortController.abort();
        };
    }, [selectedSong, onFilesFound]);

    const renderFileIcon = (type: string) => {
        const className = "w-6 h-6 mr-3 text-slate-400 flex-shrink-0";
        if (type.startsWith('Illustration')) return <PhotoIcon className={className} />;
        if (type === 'Audio') return <AudioIcon className={className} />;
        if (type.startsWith('Chart')) return <DocumentTextIcon className={className} />;
        return null;
    }
    const translateFileType = (type: string): string => {
        if (type === 'Illustration') return '曲绘';
        if (type === 'Illustration (Low-Res)') return '曲绘（低分辨率）';
        if (type === 'Illustration (Blur)') return '曲绘（模糊）';
        if (type === 'Audio') return '音频';
        if (type.startsWith('Chart (')) {
            const diff = type.replace('Chart (', '').replace(')', '');
            return `谱面（${diff}）`;
        }
        const perDiff = type.match(/^Illustration \((EZ|HD|IN|AT)\)$/);
        if (perDiff) return `曲绘（${perDiff[1]}）`;
        return type;
    };

    const getResolution = (type: string) => RESOLUTIONS[type] ?? null;

    const renderPreview = (file: FileInfo) => {
        if (!file.type.startsWith('Illustration') || !selectedSong) return null;
        // 每难度曲绘没有低清版本，直接用自己的文件；其余统一用低清图做缩略图
        const perDiff = /^Illustration \((EZ|HD|IN|AT)\)$/.test(file.type);
        const src = perDiff
            ? file.url
            : ghRaw(`7aGiven/Phigros_Resource/refs/heads/illustrationLowRes/${selectedSong.id}.png`);
        return (
            <div className="w-12 h-[34px] mr-2 rounded-[5px] overflow-hidden border border-white/[.08] bg-[repeating-linear-gradient(135deg,#1e293b_0_4px,#172033_4px_8px)] flex-shrink-0 align-middle">
                <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
            </div>
        );
    };

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center gap-3 text-sm text-slate-400 py-10">
                    <Spinner />
                    <span>正在检查可用文件…</span>
                </div>
            );
        }

        if (files.length > 0) {
            return (
                <div className="flex flex-col rounded-xl border border-white/[.07] bg-white/[.02] overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto thin-scroll">
                    <table className="min-w-full text-sm text-left text-slate-300">
                        <thead>
                            <tr className="border-b border-white/[.06]">
                                <th scope="col" className="px-4 py-2.5 font-mono text-[10px] font-medium tracking-[.14em] uppercase text-slate-500">文件类型</th>
                                <th scope="col" className="px-4 py-2.5 font-mono text-[10px] font-medium tracking-[.14em] uppercase text-slate-500">文件名</th>
                                <th scope="col" className="px-4 py-2.5 text-right font-mono text-[10px] font-medium tracking-[.14em] uppercase text-slate-500">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map(file => {
                                const isDownloadingThisFile = downloadingUrl === file.url;
                                const resolution = getResolution(file.type);
                                const size = formatBytes(file.size);
                                return (
                                <tr key={file.url} className="border-b border-white/[.06] last:border-b-0 hover:bg-[rgba(34,211,238,.04)] transition-colors">
                                    <th scope="row" className="px-4 py-2.5 font-medium whitespace-nowrap">
                                        <div className="flex items-center">
                                            {renderPreview(file)}
                                            {renderFileIcon(file.type)}
                                            <span>{translateFileType(file.type)}</span>
                                            {resolution && settings.advancedInfo && (
                                                <div className="group relative inline-flex items-center ml-2">
                                                    <button type="button" className="focus:outline-none" aria-label="分辨率信息">
                                                        <InformationCircleIcon className="w-4 h-4 text-slate-500 hover:text-brand-cyan cursor-help transition-colors duration-200" />
                                                    </button>
                                                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:absolute sm:top-auto sm:bottom-full sm:left-1/2 sm:translate-y-0 sm:-translate-x-1/2 mb-0 sm:mb-2 hidden group-hover:block group-focus-within:block w-max max-w-[90vw] sm:max-w-none px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[100]">
                                                        <span className="text-brand-cyan font-mono text-xs font-bold">{resolution}</span>
                                                        <div className="hidden sm:block absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] w-2.5 h-2.5 bg-slate-900 border-r border-b border-slate-700 rotate-45"></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </th>
                                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="break-all">{file.name}</span>
                                            {size && <span className="font-mono text-[10px] text-slate-600">{size}</span>}
                                            {file.tooltip && (
                                                <span className="font-sans text-[11px] text-slate-400" title={file.tooltip}>{file.tooltip}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <button
                                            onClick={() => handleDownloadClick(file)}
                                            disabled={!!downloadingUrl}
                                            className="inline-flex items-center justify-center gap-2 min-w-[140px] text-[13px] font-semibold text-[#22d3ee] hover:text-[#67e8f9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isDownloadingThisFile ? (
                                                <>
                                                    <Spinner />
                                                    <span>正在下载资源...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowDownTrayIcon className="w-5 h-5" />
                                                    <span>下载资源</span>
                                                </>
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex items-center justify-center h-40 text-slate-500 rounded-b-xl">
                <p>未找到此歌曲的文件。</p>
            </div>
        );
    };

    if (!selectedSong) {
        return (
            <div className="relative w-full mx-auto overflow-hidden rounded-xl border border-dashed border-slate-700 bg-transparent p-6 text-center">
                <p className="text-slate-500">从左侧列表选择歌曲以查看可下载的文件。</p>
                <p className="text-slate-500"></p>
            </div>
        );
    }

    return (
        <>
            <AssetDownloadWarningPopup
                isOpen={showAssetWarning}
                onConfirm={handleWarningConfirm}
                onCancel={handleWarningCancel}
            />
            <div className="relative w-full mx-auto rounded-xl border border-slate-700 bg-slate-800/50 shadow-lg backdrop-blur-sm">
                 <div className="px-6 py-4 border-b border-slate-700 rounded-t-xl">
                    <h3 className="font-bold text-lg text-slate-200 flex flex-wrap items-center gap-2">
                        <span>可用文件：<span className="text-brand-cyan">{selectedSong.name}</span></span>

                        {settings.advancedInfo && (
                            <div className="group relative inline-flex items-center">
                                <button type="button" className="focus:outline-none" aria-label="显示歌曲 ID">
                                    <InformationCircleIcon className="w-5 h-5 text-slate-500 hover:text-brand-cyan cursor-help transition-colors duration-200" />
                                </button>
                                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:absolute sm:top-auto sm:bottom-full sm:left-1/2 sm:translate-y-0 sm:-translate-x-1/2 mb-0 sm:mb-2 hidden group-hover:block group-focus-within:block w-max max-w-[90vw] sm:max-w-[250px] px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-[100]">
                                    <div className="text-center">
                                        <span className="text-slate-500 font-bold block mb-0.5 uppercase tracking-wider text-[10px]">歌曲 ID</span>
                                        <span className="font-mono text-sm text-brand-cyan select-all break-all leading-tight">{selectedSong.id}</span>
                                    </div>
                                    <div className="hidden sm:block absolute top-full left-1/2 -translate-x-1/2 -mt-[5px] w-2.5 h-2.5 bg-slate-900 border-r border-b border-slate-700 rotate-45"></div>
                                </div>
                            </div>
                        )}
                    </h3>
                </div>
                {renderContent()}
            </div>
        </>
    );
};
