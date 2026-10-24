// ---- メッセージ色付きHTML生成ヘルパー ----------------------------------------
const MSG = {
    error:   text => `<span style="color:#ff0055;">${text}</span>`,
    success: text => `<span style="color:#70c65b;">${text}</span>`,
    info:    text => `<span style="color:#0000cd;">${text}</span>`,
    warn:    text => `<span style="color:#ff8282;">${text}</span>`,
};

const previewError = err =>
    `<div style="padding:20px;color:red;">エラーが発生しました: ${err.message}</div>`;

const MAX_PREVIEW_ROWS = 2000;
const CHUNK_SIZE_BYTES = 80 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_UPLOAD_WEIGHT = 3;

const loadedScripts = new Map();
let active3DCleanup = null;
let currentCopyTextGetter = null;
let copyBtnResetTimer = null;

function getStaticJsBase() {
    if (APP.staticJsBase) return APP.staticJsBase;
    const scriptEl = document.querySelector('script[src*="cabinet.js"]');
    if (scriptEl && scriptEl.src) {
        const url = new URL(scriptEl.src, window.location.origin);
        return url.pathname.replace(/\/cabinet\.js$/, '');
    }
    return '/static/js';
}

function loadScript(filename) {
    if (loadedScripts.has(filename)) return loadedScripts.get(filename);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${getStaticJsBase()}/${filename}`;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => {
            loadedScripts.delete(filename);
            reject(new Error(`ライブラリの読み込みに失敗しました: ${filename}`));
        };
        document.head.appendChild(script);
    });
    loadedScripts.set(filename, promise);
    return promise;
}

async function ensurePreviewLibraries(type, ext) {
    if (type === 'excel') {
        if (!window.Arrow) await loadScript('Arrow.es2015.min.js');
    } else if (type === 'word') {
        if (!window.mammoth) await loadScript('mammoth.browser.min.js');
    } else if (type === 'markdown') {
        const tasks = [];
        if (!window.DOMPurify) tasks.push(loadScript('purify.min.js'));
        if (!window.marked) tasks.push(loadScript('marked.min.js'));
        if (tasks.length > 0) await Promise.all(tasks);
    } else if (type === '3d') {
        if (!window.THREE) await loadScript('three.min.js');
        const subTasks = [];
        if (!THREE.OrbitControls) subTasks.push(loadScript('OrbitControls.js'));
        if (ext === 'stl' && !THREE.STLLoader) {
            subTasks.push(loadScript('STLLoader.js'));
        } else if (ext === 'obj') {
            if (!THREE.OBJLoader) subTasks.push(loadScript('OBJLoader.js'));
            if (!THREE.MTLLoader) subTasks.push(loadScript('MTLLoader.js'));
        } else if ((ext === 'glb' || ext === 'gltf') && !THREE.GLTFLoader) {
            subTasks.push(loadScript('GLTFLoader.js'));
        }
        if (subTasks.length > 0) await Promise.all(subTasks);
    }
}

function disposeObject3D(object) {
    if (!object) return;
    object.traverse((child) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
            child.geometry.dispose();
        }
        if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (!mat) return;
                for (const key of Object.keys(mat)) {
                    const value = mat[key];
                    if (value && typeof value === 'object' && typeof value.dispose === 'function') {
                        value.dispose();
                    }
                }
                if (typeof mat.dispose === 'function') {
                    mat.dispose();
                }
            });
        }
    });
}

function cleanup3DPreview() {
    if (typeof active3DCleanup === 'function') {
        active3DCleanup();
        active3DCleanup = null;
    }
}

// ---- ユーティリティ ----------------------------------------
const Utils = {
    formatBytes: (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    },
    getFileIcon: (filename) => {
        const ext = (filename.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
        const icons = {
            'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'webp': '🖼️',
            'mp4': '🎞️', 'avi': '🎞️', 'mov': '🎞️', 'wmv': '🎞️', 'flv': '🎞️', 'mkv': '🎞️', 'webm': '🎞️',
            'mp3': '🎵', 'wav': '🎵', 'aac': '🎵', 'flac': '🎵', 'ogg': '🎵', 'm4a': '🎵',
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            'pdf': '📕', 'md': '🖋️', 'svg': '🎨', 'ico': '🎨',
            'csv': '📃', 'xls': '📊', 'xlsx': '📊', 'xlsm': '📊',
            'doc': '📝', 'docx': '📝', 'rtf': '📝',
            'ppt': '📑', 'pptx': '📑',
            'obj': '💎', 'mtl': '💎', 'stl': '💎', 'glb': '💎', 'gltf': '💎',
            'py': '💻', 'js': '💻', 'html': '💻', 'css': '💻', 'java': '💻', 'cpp': '💻', 'c': '💻', 'ts': '💻',
            'json': '💻', 'xml': '💻', 'yaml': '💻', 'yml': '💻', 'sh': '💻',
            'db': '🗄️', 'sqlite': '🗄️', 'sqlite3': '🗄️', 'sql': '🗄️'
        };
        return icons[ext] || '📄';
    },
    escapeHtml: (() => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return s => String(s).replace(/[&<>"']/g, c => map[c]);
    })(),
};

// ---- ボタン処理 ----------------------------------------
async function executeAdminTask(url, taskName) {
    if (!url || !APP.isAdmin) return addMessage(MSG.error('管理者のみ実行可能'));
    if (APP.isProcessing) return;
    APP.isProcessing = true;
    try {
        const response = await fetch(url);
        const data = await response.json();
        addMessage(MSG.success(`${taskName}: ${data.status}`));
    } catch (error) {
        addMessage(MSG.error(`エラーが発生しました。${error}`));
    } finally {
        APP.isProcessing = false;
    }
}

const btn1 = () => executeAdminTask(APP.endpoints.dataFormatting, "Data解析");
const btn2 = () => executeAdminTask(APP.endpoints.apply, "データベース更新");
const btn3 = () => APP.endpoints.docs
    ? window.open(APP.endpoints.docs, '_blank')
    : addMessage(MSG.error('管理者のみ実行可能'));
const btn4 = () => executeAdminTask(APP.endpoints.apply, "データベース更新");
const btn5 = () => executeAdminTask(APP.endpoints.apply, "データベース更新");
const btn6 = () => executeAdminTask(APP.endpoints.apply, "データベース更新");

// ---- メッセージ表示 ----------------------------------------
function addMessage(htmlContent) {
    const path_div = document.getElementById('on_path');
    if (!path_div) return;

    if (APP.messageTimer) {
        clearTimeout(APP.messageTimer);
    } else {
        APP.originalContent = path_div.innerHTML;
    }
    path_div.innerHTML = window.innerWidth < 700
        ? `<div class="message-scroll-wrap"><div class="message-scroll-text">${htmlContent}</div></div>`
        : htmlContent;

    APP.messageTimer = setTimeout(() => {
        path_div.innerHTML = APP.originalContent;
        APP.messageTimer = null;
    }, 3500);
}

// ---- ドラッグ＆ドロップ ----------------------------------------
const clearFolderHighlights = () =>
    document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));

function setupDropZone(element, targetPathResolver) {
    if (!element) return;
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
        element.addEventListener(evt, preventDefaults, false));

    element.addEventListener('dragover', (e) => {
        const folder = e.target.closest('.folder');
        if (folder) {
            element.classList.remove('drag-over');
            clearFolderHighlights();
            folder.classList.add('drag-over');
        } else {
            element.classList.add('drag-over');
            clearFolderHighlights();
        }
    });

    element.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !element.contains(e.relatedTarget)) {
            element.classList.remove('drag-over');
            clearFolderHighlights();
        }
    });

    element.addEventListener('drop', async (e) => {
        element.classList.remove('drag-over');
        clearFolderHighlights();

        const targetPath = targetPathResolver(e);

        try {
            const dragDataStr = e.dataTransfer.getData('application/json');
            if (dragDataStr) {
                const dragData = JSON.parse(dragDataStr);
                if (dragData.type === 'internal_file') {
                    if (targetPath !== APP.currentPath) executeMove(dragData.uuid, dragData.name, targetPath);
                    return;
                }
            }
        } catch (err) {}

        if (e.dataTransfer.items) {
            const entries = [];
            for (const item of e.dataTransfer.items) {
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) entries.push(entry);
                }
            }
            if (entries.length > 0) {
                APP.pendingScans++;
                try {
                    const nestedFiles = await Promise.all(entries.map(entry => traverseFileTree(entry, targetPath)));
                    const flatFiles = nestedFiles.flat();
                    enqueueUploads(flatFiles);
                } finally {
                    APP.pendingScans--;
                    checkAllUploadsComplete();
                }
            }
        } else if (e.dataTransfer.files.length > 0) {
            const items = Array.from(e.dataTransfer.files).map(file => ({ file, targetPath }));
            enqueueUploads(items);
        }
    });
}

// ---- 初期化 ----------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const capacityLabel = document.getElementById('capacity-label');
    const fillBar = document.getElementById('capacity-bar-fill');
    if (capacityLabel && fillBar) {
        capacityLabel.textContent = `${Utils.formatBytes(APP.usedCapacity)} / ${Utils.formatBytes(APP.maxCapacity)}`;
        const capacityPercent = Math.min((APP.usedCapacity / APP.maxCapacity) * 100, 100);
        fillBar.style.width = `${capacityPercent}%`;
        if (capacityPercent > 90) {
            fillBar.style.backgroundColor = '#ff8282';
            fillBar.style.boxShadow = '0 0 10px #ff8282';
        }
    }

    document.querySelectorAll('.file-size').forEach(el =>
        el.textContent = `Size: ${Utils.formatBytes(parseInt(el.dataset.size, 10))}`);
    document.querySelectorAll('.file-icon').forEach(el => {
        if (el.dataset.filename) el.textContent = Utils.getFileIcon(el.dataset.filename);
    });

    document.querySelectorAll('.up-btn[data-navigate]').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.navigate || ''));
    });

    setupDropZone(document.getElementById('detail'), e => {
        const folder = e.target.closest('.folder');
        return folder ? folder.getAttribute('data-path') : APP.currentPath;
    });
    setupDropZone(document.querySelector('.up-btn[data-path]'), e =>
        e.currentTarget.getAttribute('data-path'));

    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.addEventListener('dragstart', (e) => {
            const li = e.target.closest('li.bulletin_board2:not(.folder)');
            if (li) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'internal_file',
                    uuid: li.dataset.uuid,
                    name: li.dataset.name || li.querySelector('.item-title')?.textContent || 'ファイル'
                }));
            } else {
                e.preventDefault();
            }
        });

        let clickCount = 0;
        let clickTimer = null;
        let lastTarget = null;

        fileList.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('button.cli');
            if (actionBtn) {
                const li = actionBtn.closest('li.bulletin_board2:not(.upload-item)');
                if (!li) return;
                e.stopPropagation();

                const name = li.dataset.name || li.querySelector('.item-title')?.textContent || '';
                const uuid = li.dataset.uuid || '';
                const path = li.dataset.path || '';
                const size = Number(li.dataset.size || 0);
                const created = li.dataset.created || '';
                const isDir = li.dataset.isDir === 'true' || li.classList.contains('folder');
                const itemCount = Number(li.dataset.itemCount || 0);

                if (actionBtn.classList.contains('edit-btn') || actionBtn.classList.contains('preview-btn')) {
                    openPreview(name, uuid, size, created);
                } else if (actionBtn.classList.contains('dl-btn')) {
                    downloadFile(uuid, name);
                } else if (actionBtn.classList.contains('del-btn')) {
                    showDeleteConfirm(actionBtn, path, name, isDir, itemCount);
                }
                return;
            }

            if (['BUTTON', 'A'].includes(e.target.tagName) || e.target.closest('.item-actions')) return;
            const li = e.target.closest('li.bulletin_board2:not(.upload-item)');
            if (!li || window.getSelection().toString().length > 0) return;

            if (lastTarget !== li) {
                clickCount = 0;
                lastTarget = li;
            }

            clickCount++;
            if (clickCount === 3) {
                clearTimeout(clickTimer);
                executeRenamePrompt(li);
                clickCount = 0;
                lastTarget = null;
                return;
            }

            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                const count = clickCount;
                clickCount = 0;
                lastTarget = null;

                if (count === 1 && li.classList.contains('folder')) {
                    const path = li.getAttribute('data-path');
                    if (path) navigate(path);
                } else if (count === 2 && !li.classList.contains('folder')) {
                    if (li.dataset.protected === 'true' && !APP.isAdmin) {
                        addMessage(MSG.error('このファイルは保護されているため、リンクをコピーできません。'));
                        return;
                    }
                    const uuid = li.dataset.uuid;
                    if (uuid) copyLinkToClipboard(uuid, li.dataset.name || li.querySelector('.item-title')?.textContent || 'ファイル');
                }
            }, 200);
        });
    }

    const previewModal = document.getElementById('preview-modal');
    if (previewModal) {
        ['click', 'touchend'].forEach(evt => {
            previewModal.addEventListener(evt, function(e) {
                if (e.target !== this) return;
                if (evt === 'touchend') e.preventDefault();
                const saveBtn = document.getElementById('save-txt-btn');
                if (saveBtn && saveBtn.style.display !== 'none') return;
                closeModal();
            });
        });
    }

    const onPathDiv    = document.getElementById('on_path');
    const searchInput  = document.getElementById('search_input');
    const searchButton = document.getElementById('search_button');

    if (onPathDiv && searchInput) {
        const activateSearch = () => {
            if (APP.messageTimer) return;
            onPathDiv.style.display   = 'none';
            searchInput.style.display = 'block';
            searchInput.focus();
        };

        onPathDiv.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('breadcrumb-item')) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        onPathDiv.addEventListener('focus', activateSearch);
        onPathDiv.addEventListener('click', (e) => {
            const crumb = e.target.closest('.breadcrumb-item');
            if (crumb) {
                e.stopPropagation();
                navigate(crumb.dataset.path || '');
                return;
            }
            activateSearch();
        });

        searchInput.addEventListener('blur', () => {
            if (searchInput.value.trim() === '') {
                searchInput.style.display = 'none';
                onPathDiv.style.display   = 'flex';
            }
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                executeSearch();
            }
        });
    }

    if (searchButton) {
        searchButton.addEventListener('click', () => {
            if (searchInput && searchInput.style.display === 'block' && searchInput.value.trim() !== '') {
                executeSearch();
            } else if (onPathDiv && searchInput) {
                onPathDiv.style.display   = 'none';
                searchInput.style.display = 'block';
                searchInput.focus();
            }
        });
    }

    function executeSearch() {
        const query = searchInput.value.trim();
        if (query === '') return;
        window.location.href = `${APP.basePath}/?query=${encodeURIComponent(query)}`;
    }

    const urlParams    = new URLSearchParams(window.location.search);
    const previewUuid  = urlParams.get('preview');
    if (previewUuid) {
        const targetBtn = document.querySelector(`li[data-uuid="${previewUuid}"] .preview-btn`) || 
                          document.querySelector(`li[data-uuid="${previewUuid}"] .edit-btn`);
        if (targetBtn) {
            setTimeout(() => targetBtn.click(), 35);
        } else {
            addMessage(MSG.error('指定されたファイルが見つかりません。'));
        }
    }
});

// ---- ナビゲーション・フォルダ操作 ----------------------------------------
function navigate(path) {
    window.location.href = `${APP.basePath}/?path=${encodeURIComponent(path)}`;
}

async function createFolder() {
    const folderName = prompt("新規フォルダ名を入力してください:");
    if (!folderName) return;
    const formData = new FormData();
    formData.append("path", APP.currentPath);
    formData.append("folder_name", folderName);
    try {
        const res = await fetch(`${APP.basePath}/mkdir/`, { method: "POST", body: formData });
        res.ok
            ? location.reload()
            : addMessage(MSG.error('フォルダの作成に失敗しました。'));
    } catch (error) {
        addMessage(MSG.error(`エラーが発生しました。${error}`));
    }
}

// ---- テキスト作成 ----------------------------------------

async function createTxt() {
    let fileName = prompt("新規テキストファイル名を入力してください:");
    if (!fileName) return;

    fileName = fileName.trim();
    if (!fileName.toLowerCase().endsWith('.txt')) {
        fileName += '.txt';
    }

    const file = new File([""], fileName, { 
        type: "text/plain", 
        lastModified: Date.now() 
    });

    await executeUpload(file, APP.currentPath, (data) => {
        if (data && data.uuid) {
            const url = new URL(window.location.href);
            url.searchParams.set('preview', data.uuid);

            if (APP.activeUploads === 0 && uploadQueue.length === 0 && APP.pendingScans === 0) {
                window.location.href = url.toString();
            } else {
                pendingRedirectUrl = url.toString();
                addMessage(MSG.success(`${Utils.escapeHtml(fileName)}を作成しました。[他のアップロード完了後に表示されます]`));
            }
        } else {
            location.reload();
        }
    });
}

// ---- アップロード ----------------------------------------
const uploadQueue = [];
let activeUploadWeight = 0;
let hasCompletedStandardUpload = false;
let pendingRedirectUrl = null;

function getUploadWeight(size) {
    if (size >= 80 * 1024 * 1024) return 3;
    if (size >= 10 * 1024 * 1024) return 1.5;
    return 1;
}

function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput.files.length) return;
    const items = Array.from(fileInput.files).map(file => ({ file, targetPath: APP.currentPath }));
    enqueueUploads(items);
    fileInput.value = "";
}

function traverseFileTree(item, path = "") {
    return new Promise((resolve) => {
        if (item.isFile) {
            item.file(
                file => resolve([{ file, targetPath: path }]),
                () => resolve([])
            );
        } else if (item.isDirectory) {
            const nextPath = path ? path + "/" + item.name : item.name;
            const dirReader = item.createReader();
            const allEntries = [];
            const readEntries = () => {
                dirReader.readEntries(async (entries) => {
                    if (entries.length > 0) {
                        allEntries.push(...entries);
                        readEntries();
                    } else {
                        const nested = await Promise.all(allEntries.map(entry => traverseFileTree(entry, nextPath)));
                        resolve(nested.flat());
                    }
                }, () => resolve([]));
            };
            readEntries();
        } else {
            resolve([]);
        }
    });
}

function enqueueUploads(items) {
    const promises = items.map(item => createUploadTask(item.file, item.targetPath ?? APP.currentPath, item.onSuccess || null));
    processUploadQueue();
    return Promise.all(promises);
}

function executeUpload(file, targetPath = APP.currentPath, onSuccess = null) {
    const promise = createUploadTask(file, targetPath, onSuccess);
    processUploadQueue();
    return promise;
}

function createUploadTask(file, targetPath = APP.currentPath, onSuccess = null) {
    return new Promise((resolve) => {
        if (file.size > APP.currentRemainingCapacity) {
            alert(`【容量超過】\nストレージの空き容量が不足しています。\n\nファイル名: ${file.name}\nサイズ: ${Utils.formatBytes(file.size)}`);
            resolve();
            return;
        }

        APP.currentRemainingCapacity -= file.size;

        const fileList = document.getElementById('file-list');
        const uploadLi = document.createElement('li');
        uploadLi.className = 'bulletin_board2 upload-item none_selection';

        const displayPath = targetPath !== APP.currentPath
            ? targetPath.replace(APP.currentPath, "").replace(/^\//, "") + "/"
            : "";

        uploadLi.innerHTML = `
            <div class="upload-progress-bg"></div>
            <div class="item-icon">${Utils.getFileIcon(file.name)}</div>
            <div class="item-info">
                <div class="item-title">${Utils.escapeHtml(displayPath + file.name)}</div>
                <div class="item-meta"><span class="upload-status-text">Waiting...</span><span class="upload-percent" style="margin-left: 5px;">0%</span></div>
            </div>
            <div class="item-actions">
                <button class="cli danger cancel-upload-btn" style="position: relative; z-index: 2;">中止</button>
            </div>`;

        const statusMsg = fileList.querySelector('.status-message');
        if (statusMsg) statusMsg.style.display = 'none';
        fileList.insertBefore(uploadLi, fileList.firstChild);

        const task = {
            file,
            targetPath,
            onSuccess,
            resolve,
            uploadLi,
            statusMsg,
            progressBg: uploadLi.querySelector('.upload-progress-bg'),
            progressText: uploadLi.querySelector('.upload-percent'),
            statusText: uploadLi.querySelector('.upload-status-text'),
            uploadId: Date.now().toString(36) + Math.random().toString(36).substring(2),
            weight: getUploadWeight(file.size),
            started: false,
            isCancelled: false,
            abortController: null
        };

        uploadLi.querySelector('.cancel-upload-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            task.isCancelled = true;
            if (!task.started) {
                const idx = uploadQueue.indexOf(task);
                if (idx !== -1) uploadQueue.splice(idx, 1);
                cleanupTaskUI(task, MSG.warn(`アップロードを中止しました: ${Utils.escapeHtml(file.name)}`));
                task.resolve();
                checkAllUploadsComplete();
            } else if (task.abortController) {
                task.abortController.abort();
            }
        });

        uploadQueue.push(task);
    });
}

function cleanupTaskUI(task, msg) {
    APP.currentRemainingCapacity += task.file.size;
    task.uploadLi.remove();
    if (msg) addMessage(msg);
    const fileList = document.getElementById('file-list');
    if (APP.activeUploads === 0 && uploadQueue.length === 0 && fileList && fileList.children.length === 0 && task.statusMsg) {
        task.statusMsg.style.display = 'block';
    }
}

async function notifyServerCancel(task) {
    const formData = new FormData();
    formData.append("path", task.targetPath);
    formData.append("filename", task.file.name);
    formData.append("upload_id", task.uploadId);
    try {
        await fetch(`${APP.basePath}/upload/cancel/`, { method: "POST", body: formData });
    } catch (e) {}
}

function processUploadQueue() {
    while (APP.activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
        const availableWeight = MAX_UPLOAD_WEIGHT - activeUploadWeight;
        let nextIndex = -1;

        if (APP.activeUploads === 0) {
            nextIndex = 0;
        } else {
            nextIndex = uploadQueue.findIndex(t => t.weight <= availableWeight);
        }

        if (nextIndex === -1) break;

        const task = uploadQueue.splice(nextIndex, 1)[0];
        if (task.isCancelled) continue;

        task.started = true;
        APP.activeUploads++;
        activeUploadWeight += task.weight;

        runUploadTask(task);
    }
}

async function runUploadTask(task) {
    const { file, targetPath, uploadId, progressBg, progressText, statusText } = task;
    if (statusText) statusText.textContent = "Uploading...";

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES) || 1;

    try {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            if (task.isCancelled) {
                await notifyServerCancel(task);
                cleanupTaskUI(task, MSG.warn(`アップロードを中止しました: ${Utils.escapeHtml(file.name)}`));
                return;
            }

            const start = chunkIndex * CHUNK_SIZE_BYTES;
            const end   = Math.min(start + CHUNK_SIZE_BYTES, file.size);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append("path",         targetPath);
            formData.append("filename",     file.name);
            formData.append("total_size",   file.size);
            formData.append("chunk_index",  chunkIndex);
            formData.append("total_chunks", totalChunks);
            formData.append("upload_id",    uploadId);
            formData.append("file",         chunk);

            task.abortController = new AbortController();
            const response = await fetch(`${APP.basePath}/upload/`, {
                method: 'POST',
                body: formData,
                signal: task.abortController.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || "Upload failed");
            }

            const data    = await response.json();
            const percent = ((chunkIndex + 1) / totalChunks) * 100;
            progressBg.style.width   = `${percent}%`;
            progressText.textContent = `${Math.floor(percent)}%`;

            if (data.completed) {
                if (task.onSuccess) {
                    task.onSuccess(data);
                } else {
                    hasCompletedStandardUpload = true;
                }
                return;
            }
        }
    } catch (error) {
        if (task.isCancelled || error.name === 'AbortError') {
            await notifyServerCancel(task);
            cleanupTaskUI(task, MSG.warn(`アップロードを中止しました: ${Utils.escapeHtml(file.name)}`));
        } else {
            await notifyServerCancel(task);
            cleanupTaskUI(task, MSG.error(`アップロードエラー: ${Utils.escapeHtml(error.message)}`));
        }
    } finally {
        APP.activeUploads--;
        activeUploadWeight = Math.max(0, activeUploadWeight - task.weight);
        task.resolve();
        processUploadQueue();
        checkAllUploadsComplete();
    }
}

function checkAllUploadsComplete() {
    if (APP.activeUploads === 0 && uploadQueue.length === 0 && APP.pendingScans === 0) {
        if (pendingRedirectUrl) {
            const url = pendingRedirectUrl;
            pendingRedirectUrl = null;
            window.location.href = url;
        } else if (hasCompletedStandardUpload) {
            hasCompletedStandardUpload = false;
            location.reload();
        }
    }
}

// ---- ファイル操作 ----------------------------------------
async function executeMove(uuid, filename, targetPath) {
    const formData = new FormData();
    formData.append("uuid",         uuid);
    formData.append("filename",     filename);
    formData.append("current_path", APP.currentPath);
    formData.append("target_path",  targetPath);

    try {
        const res = await fetch(`${APP.basePath}/move/`, { method: "POST", body: formData });
        if (res.ok) {
            location.reload();
        } else {
            let errorMsg = '同名のファイルがあります。';
            try {
                const errRes = await res.json();
                if (errRes.detail) errorMsg = errRes.detail;
            } catch (e) {}
            addMessage(MSG.error(`移動に失敗しました。理由: ${errorMsg}`));
        }
    } catch (error) {
        addMessage(MSG.error('通信エラーが発生しました。'));
    }
}

function showDeleteConfirm(buttonElement, path, name, isDir = false, itemCount = 0) {
    const liElement = buttonElement.closest('li');
    if (!liElement || liElement.querySelector('.delete-confirm-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay none_selection';

    let message = "削除しますか？";
    if (isDir && itemCount > 0) {
        message = `中身(${itemCount})あり。削除しますか？`;
        overlay.style.backgroundColor = "rgba(255, 60, 60, 0.85)";
    }

    overlay.innerHTML = `
        <span class="delete-confirm-text">${message}</span>
        <div class="delete-confirm-actions">
            <button class="confirm-btn">削除</button>
            <button class="cancel-btn">キャンセル</button>
        </div>`;

    overlay.querySelector('.cancel-btn').onclick = (e) => { e.stopPropagation(); overlay.remove(); };
    overlay.querySelector('.confirm-btn').onclick = (e) => {
        e.stopPropagation();
        if (isDir && itemCount > 0 &&
            !confirm(`フォルダ「${name}」には ${itemCount} 個のアイテムが含まれています。\n完全に削除してよろしいですか？`)) {
            overlay.remove();
            return;
        }
        executeDelete(path);
    };

    overlay.onclick = (e) => e.stopPropagation();
    liElement.appendChild(overlay);
}

async function executeDelete(path) {
    try {
        const res = await fetch(`${APP.basePath}/delete/?path=${encodeURIComponent(path)}`, { method: "DELETE" });
        res.ok ? location.reload() : alert("削除に失敗しました。");
    } catch (error) {
        alert("通信エラーが発生しました。");
    }
}

async function downloadFile(uuid, filename) {
    const url = `${APP.basePath}/f/${uuid}`;
    if (window.showSaveFilePicker) {
        try {
            const handle   = await window.showSaveFilePicker({ suggestedName: filename });
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
            const writable = await handle.createWritable();
            await response.body.pipeTo(writable);
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('File save error:', err);
        }
    }
    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function copyLinkToClipboard(uuid, filename) {
    const link = window.location.origin + APP.basePath + '/f/' + uuid;
    navigator.clipboard.writeText(link)
        .then(()  => addMessage(MSG.info(`${Utils.escapeHtml(filename)}のリンクをコピーしました`)))
        .catch(() => addMessage(MSG.error(`${Utils.escapeHtml(filename)}のコピーに失敗しました`)));
}

// ---- 名前編集モーダル ----------------------------------------
let currentEditingItem = null;
let currentExt = '';

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
    currentEditingItem = null;
    currentExt = '';
}

function executeRenamePrompt(li) {
    if (li.dataset.protected === 'true' && !APP.isAdmin) {
        const typeStr = li.classList.contains('folder') ? 'フォルダ' : 'ファイル';
        return addMessage(MSG.error(`この${typeStr}は保護されています。`));
    }

    const fullDisplayName = li.dataset.name || li.querySelector('.item-title').textContent;
    const isFolder        = li.classList.contains('folder');

    let baseName = fullDisplayName;
    currentExt = '';

    if (!isFolder && !APP.isAdmin) {
        const lastDot = fullDisplayName.lastIndexOf('.');
        if (lastDot > 0) {
            baseName   = fullDisplayName.substring(0, lastDot);
            currentExt = fullDisplayName.substring(lastDot);
        }
    }

    const tags = isFolder ? '' : Array.from(li.querySelectorAll('.item-tags span'))
        .map(s => s.textContent.replace('#', '').trim())
        .filter(t => t !== '管理者用')
        .join(', ');

    currentEditingItem = {
        path:     li.dataset.path,
        name:     fullDisplayName,
        isFolder: isFolder
    };

    const modalTitle = document.getElementById('edit-modal-title');
    if (modalTitle) modalTitle.textContent = fullDisplayName;

    const nameInput  = document.getElementById('edit-name-input');
    const extDisplay = document.getElementById('edit-ext-display');

    nameInput.value          = baseName;
    extDisplay.textContent   = currentExt;
    extDisplay.style.display = (isFolder || APP.isAdmin) ? 'none' : 'inline';

    document.getElementById('edit-tags-input').value         = tags;
    document.getElementById('edit-tags-group').style.display = isFolder ? 'none' : 'block';
    document.getElementById('edit-modal').style.display      = 'flex';

    setTimeout(() => nameInput.focus(), 100);
}

async function saveItemChanges() {
    if (!currentEditingItem) return;

    const newBaseName = document.getElementById('edit-name-input').value.trim();
    const tags        = document.getElementById('edit-tags-input').value.trim();

    if (!newBaseName) return alert("名前を入力してください。");

    const finalName = newBaseName + currentExt;
    const formData  = new FormData();
    formData.append("path",     currentEditingItem.path);
    formData.append("new_name", finalName);
    formData.append("tags",     tags);

    try {
        const res = await fetch(`${APP.basePath}/update_metadata/`, { method: "POST", body: formData });
        if (res.ok) {
            location.reload();
        } else {
            const data = await res.json();
            addMessage(MSG.error(data.detail || "エラーが発生しました"));
        }
    } catch (error) {
        addMessage(MSG.error('通信エラーが発生しました。'));
    }
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('edit-modal');
    if (e.target === modal) closeEditModal();
});

// ---- プレビュー ----------------------------------------
function getPreviewType(ext) {
    if (APP.extCategories) {
        for (const [category, exts] of Object.entries(APP.extCategories)) {
            if (exts.includes(ext)) {
                return category === 'edit' ? 'text' : category;
            }
        }
    }
    return 'unsupported';
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const len = text.length;

    for (let i = 0; i < len; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (i + 1 < len && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                row.push(field);
                field = '';
            } else if (c === '\r') {
                if (i + 1 < len && text[i + 1] === '\n') {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else if (c === '\n') {
                row.push(field);
                rows.push(row);
                row = [];
                field = '';
            } else {
                field += c;
            }
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function rowsToExcelTsv(rows) {
    return rows.map(row =>
        row.map(cell => {
            const str = String(cell ?? '');
            if (/[\t\r\n"]/.test(str)) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join('\t')
    ).join('\r\n');
}

function copyPreviewContent() {
    if (typeof currentCopyTextGetter !== 'function') return;
    const text = currentCopyTextGetter();
    const copyBtn = document.getElementById('copy-content-btn');

    navigator.clipboard.writeText(text)
        .then(() => {
            addMessage(MSG.info('内容をクリップボードにコピーしました'));
            if (copyBtn) {
                if (copyBtnResetTimer) clearTimeout(copyBtnResetTimer);
                copyBtn.textContent = 'コピー済';
                copyBtnResetTimer = setTimeout(() => {
                    copyBtn.textContent = 'コピー';
                    copyBtnResetTimer = null;
                }, 1500);
            }
        })
        .catch(() => addMessage(MSG.error('コピーに失敗しました')));
}

function openPreview(filename, uuid, size, dateStr) {
    const ext  = (filename.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    const type = getPreviewType(ext);

    if (type === 'unsupported')
        return addMessage(MSG.error(`${Utils.escapeHtml(filename)} はプレビュー非対応です。[DL]から確認してください。`));

    cleanup3DPreview();
    currentCopyTextGetter = null;

    const modal        = document.getElementById('preview-modal');
    const content      = document.getElementById('modal-content');
    const landscapeBtn = document.getElementById('landscape-btn');
    const saveBtn      = document.getElementById('save-txt-btn');
    const copyBtn      = document.getElementById('copy-content-btn');
    const url          = `${APP.basePath}/f/${uuid}?inline=true`;

    document.getElementById('modal-title').textContent = filename;
    document.getElementById('modal-size').textContent  = `Size: ${Utils.formatBytes(size)}`;
    if (document.getElementById('modal-date')) document.getElementById('modal-date').textContent = dateStr || '';
    if (landscapeBtn) landscapeBtn.style.display = 'none';
    if (saveBtn) {
        saveBtn.style.display = 'none';
        saveBtn.dataset.uuid  = '';
    }
    if (copyBtn) {
        if (copyBtnResetTimer) {
            clearTimeout(copyBtnResetTimer);
            copyBtnResetTimer = null;
        }
        copyBtn.textContent   = 'コピー';
        copyBtn.style.display = 'none';
    }

    content.innerHTML = '<div style="padding: 20px; color: #fff;">Loading...</div>';
    modal.classList.add('active');

    const handlers = {
        'image': () => `<img src="${url}" class="preview-image" alt="preview">`,

        'video': () => {
            if (landscapeBtn) landscapeBtn.style.display = 'block';
            return `<video id="preview-video-el" class="preview-video" playsinline autoplay loop onclick="this.setAttribute('controls','controls');this.onclick=null;"><source src="${url}"></video>`;
        },

        'audio': async () => {
            let metaHtml     = '';
            let displayTitle = Utils.escapeHtml(filename);
            let coverHtml    = `<div class="preview-audio-icon">🎵</div>`;

            try {
                const res = await fetch(`${APP.basePath}/audio/meta/${uuid}`);
                if (res.ok) {
                    const meta = await res.json();
                    if (meta.title && meta.title !== 'Unknown' && meta.title !== filename)
                        displayTitle = Utils.escapeHtml(meta.title);
                    if (meta.has_cover)
                        coverHtml = `<img src="${APP.basePath}/audio/cover/${uuid}" class="audio-cover-img" alt="cover">`;
                    metaHtml = `
                        <div class="audio-artist">${Utils.escapeHtml(meta.artist)}</div>
                        <div class="audio-album">${Utils.escapeHtml(meta.album)}</div>
                        <div class="audio-tech">
                            <span>${Utils.escapeHtml(meta.duration)}</span>
                            ${meta.bitrate !== 'Unknown' ? `<span class="audio-dot">•</span><span>${Utils.escapeHtml(meta.bitrate)}</span>` : ''}
                        </div>`;
                }
            } catch (e) { console.error('Failed to fetch audio metadata', e); }

            content.innerHTML = `
                <div class="preview-audio-wrapper" onclick="const a=this.querySelector('audio');if(a){a.muted=false;}">
                    <div class="audio-cover-container">${coverHtml}</div>
                    <div class="audio-details">
                        <div class="audio-title">${displayTitle}</div>
                        ${metaHtml}
                    </div>
                    <audio class="modern-audio-player" controls autoplay muted loop><source src="${url}">お使いのブラウザはaudio要素をサポートしていません。</audio>
                </div>`;
        },

        'pdf': () => `<iframe src="${url}" style="width:100%;height:100%;border:none;background-color:#fff;"></iframe>`,

        'svg': async () => {
            content.innerHTML = '<div style="padding: 20px;">SVGを最適化しています...</div>';
            try {
                const response = await fetch(url);
                const svgText  = await response.text();
                const svgEl    = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
                if (svgEl && svgEl.tagName.toLowerCase() === 'svg') {
                    if (!svgEl.getAttribute('viewBox')) {
                        const w = svgEl.getAttribute('width'), h = svgEl.getAttribute('height');
                        if (w && h && !w.includes('%') && !h.includes('%'))
                            svgEl.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
                    }
                    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                    Object.assign(svgEl.style, { width: '100%', height: '100%', maxHeight: '100%', display: 'block', margin: 'auto' });

                    const containerId = 'svg-container-' + Date.now();
                    content.innerHTML = `<div id="${containerId}" style="width:100%;height:100%;background-color:#fff;overflow:auto;display:grid;place-items:center;box-sizing:border-box;padding:15px;opacity:0;transition:opacity 0.2s ease;">${svgEl.outerHTML}</div>`;
                    setTimeout(() => {
                        const container = document.getElementById(containerId);
                        if (container) container.style.opacity = '1';
                    }, 50);
                } else throw new Error("SVG parse failed");
            } catch (err) {
                content.innerHTML = `<div style="width:100%;height:100%;background-color:#fff;display:grid;place-items:center;overflow:auto;"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;"></div>`;
            }
        },

        'word': async () => {
            try {
                const [, response] = await Promise.all([
                    ensurePreviewLibraries('word', ext),
                    fetch(url)
                ]);
                const arrayBuffer = await response.arrayBuffer();
                const result      = await mammoth.convertToHtml({ arrayBuffer });
                content.innerHTML = `<div style="padding:20px;background:#fff;width:100%;height:100%;overflow-y:auto;box-sizing:border-box;text-align:left;color:#333;line-height:1.6;">${result.value}</div>`;
            } catch (err) { content.innerHTML = previewError(err); }
        },

        'text': async () => {
            try {
                const response    = await fetch(url, { cache: 'no-store' });
                const textContent = await response.text();
                if (APP.extCategories?.edit?.includes(ext) || ext === 'txt') {
                    content.innerHTML = `<textarea id="edit-text-area" class="preview-text" style="resize:none;outline:none;">${Utils.escapeHtml(textContent)}</textarea>`;
                    if (saveBtn) {
                        saveBtn.style.display = 'block';
                        saveBtn.dataset.uuid  = uuid;
                    }
                    if (ext === 'txt' && copyBtn) {
                        currentCopyTextGetter = () => document.getElementById('edit-text-area')?.value ?? textContent;
                        copyBtn.style.display = 'block';
                    }
                } else {
                    content.innerHTML = `<pre class="preview-text">${Utils.escapeHtml(textContent)}</pre>`;
                }
            } catch (err) { content.innerHTML = previewError(err); }
        },

        'markdown': async () => {
            try {
                const [, response] = await Promise.all([
                    ensurePreviewLibraries('markdown', ext),
                    fetch(url)
                ]);
                const text = await response.text();
                content.innerHTML = `<div class="preview-markdown">${DOMPurify.sanitize(marked.parse(text))}</div>`;
            } catch (err) { content.innerHTML = previewError(err); }
        },

        'csv': async () => {
            try {
                const response    = await fetch(url);
                const fullCsvText = await response.text();
                const parsedRows  = parseCsv(fullCsvText);
                const validRows   = parsedRows.filter((r, idx) =>
                    !(r.length === 1 && r[0].trim() === '' && idx === parsedRows.length - 1)
                );
                const totalDataRows = Math.max(0, validRows.length - 1);
                const displayRows   = validRows.slice(0, MAX_PREVIEW_ROWS + 1);

                const trList = displayRows.map((row, index) => {
                    const tag = index === 0 ? 'th' : 'td';
                    return '<tr>' + row.map(col => `<${tag}>${Utils.escapeHtml(col.trim())}</${tag}>`).join('') + '</tr>';
                });

                const omittedNotice = totalDataRows > MAX_PREVIEW_ROWS
                    ? `<div style="padding:10px;text-align:center;color:#555;background:#f5f5f5;border-top:1px solid #ddd;font-size:12px;">表示上限（${MAX_PREVIEW_ROWS.toLocaleString()}件）を超えたため、残り ${(totalDataRows - MAX_PREVIEW_ROWS).toLocaleString()} 件は省略されました。</div>`
                    : '';

                content.innerHTML = `<div class="preview-csv-container" style="overflow:auto;width:100%;height:100%;box-sizing:border-box;"><table class="preview-csv">${trList.join('')}</table>${omittedNotice}</div>`;

                if (copyBtn) {
                    currentCopyTextGetter = () => rowsToExcelTsv(validRows);
                    copyBtn.style.display = 'block';
                }
            } catch (err) { content.innerHTML = previewError(err); }
        },

        'excel': () => renderExcelPreview(uuid, content),

        '3d': () => {
            let isDisposed = false;
            let animationId = null;
            let renderer = null;
            let scene = null;
            let controls = null;
            let onWindowResize = null;

            active3DCleanup = () => {
                isDisposed = true;
                if (animationId !== null) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
                if (onWindowResize) {
                    window.removeEventListener('resize', onWindowResize, false);
                    onWindowResize = null;
                }
                if (controls) {
                    controls.dispose();
                    controls = null;
                }
                if (scene) {
                    disposeObject3D(scene);
                    scene.clear();
                    scene = null;
                }
                if (renderer) {
                    renderer.dispose();
                    if (typeof renderer.forceContextLoss === 'function') {
                        renderer.forceContextLoss();
                    }
                    if (renderer.domElement && renderer.domElement.parentNode) {
                        renderer.domElement.parentNode.removeChild(renderer.domElement);
                    }
                    renderer = null;
                }
            };

            setTimeout(async () => {
                try {
                    await ensurePreviewLibraries('3d', ext);
                } catch (err) {
                    if (!isDisposed) content.innerHTML = previewError(err);
                    return;
                }

                if (isDisposed) return;
                const container = document.getElementById('preview-3d-container');
                if (!container) return;

                container.innerHTML = '';
                scene = new THREE.Scene();
                scene.background = new THREE.Color(0xf0f0f0);
                scene.add(new THREE.GridHelper(100, 50, 0xaaaaaa, 0xdddddd));

                const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
                renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(container.clientWidth, container.clientHeight);
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.outputEncoding = THREE.sRGBEncoding;
                renderer.toneMapping    = THREE.ACESFilmicToneMapping;

                const isPBR = (ext === 'glb' || ext === 'gltf');
                renderer.toneMappingExposure = isPBR ? 1.0 : 0.8;
                container.appendChild(renderer.domElement);

                controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;

                if (isPBR) {
                    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
                    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
                    hemi.position.set(0, 20, 0);
                    scene.add(hemi);
                    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
                    sun.position.set(10, 20, 10);
                    scene.add(sun);
                    const fill = new THREE.DirectionalLight(0x90b0d0, 0.5);
                    fill.position.set(-10, 0, -10);
                    scene.add(fill);
                } else {
                    scene.add(new THREE.AmbientLight(0xffffff, 0.15));
                    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
                    hemi.position.set(0, 20, 0);
                    scene.add(hemi);
                    const sun = new THREE.DirectionalLight(0xffffff, 0.4);
                    sun.position.set(10, 20, 10);
                    scene.add(sun);
                }

                const animate = () => {
                    if (isDisposed || !document.getElementById('preview-3d-container')) {
                        cleanup3DPreview();
                        return;
                    }
                    animationId = requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                };

                onWindowResize = () => {
                    const currentContainer = document.getElementById('preview-3d-container');
                    if (isDisposed || !currentContainer || !renderer) {
                        cleanup3DPreview();
                        return;
                    }
                    camera.aspect = currentContainer.clientWidth / currentContainer.clientHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(currentContainer.clientWidth, currentContainer.clientHeight);
                };
                window.addEventListener('resize', onWindowResize, false);

                const centerAndScaleModel = (object) => {
                    const box    = new THREE.Box3().setFromObject(object);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    const size   = new THREE.Vector3();
                    box.getSize(size);
                    const maxDim = Math.max(size.x, size.y, size.z);

                    object.position.x -= center.x;
                    object.position.y -= center.y;
                    object.position.z -= center.z;

                    camera.near = maxDim / 100 || 0.1;
                    camera.far  = maxDim * 100 || 1000;
                    camera.updateProjectionMatrix();
                    camera.position.set(0, maxDim * 0.4, maxDim * 2.0);

                    controls.target.set(0, 0, 0);
                    controls.maxDistance = maxDim * 10;
                    controls.update();
                };

                if (ext === 'stl') {
                    const loader = new THREE.STLLoader();
                    loader.load(url, (geometry) => {
                        if (isDisposed || !scene) {
                            geometry.dispose();
                            return;
                        }
                        const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
                            color: geometry.hasColors ? 0xffffff : 0x999999,
                            specular: 0x111111, shininess: 30, vertexColors: geometry.hasColors
                        }));
                        scene.add(mesh);
                        centerAndScaleModel(mesh);
                    });
                } else if (ext === 'obj') {
                    fetch(url).then(res => res.text()).then(text => {
                        if (isDisposed || !scene) return;
                        const mtlMatch = text.match(/^mtllib\s+(.+)$/m);

                        const loadObjFallback = () => {
                            if (isDisposed || !scene) return;
                            const object = new THREE.OBJLoader().parse(text);
                            object.traverse(child => {
                                if (child instanceof THREE.Mesh && (!child.material || !child.material.name))
                                    child.material = new THREE.MeshPhongMaterial({ color: 0x999999 });
                            });
                            scene.add(object);
                            centerAndScaleModel(object);
                        };

                        if (mtlMatch) {
                            const mtlUrl = `${APP.basePath}/f_rel/${uuid}/${mtlMatch[1].trim()}`;
                            const manager = new THREE.LoadingManager();
                            manager.setURLModifier((assetUrl) => {
                                if (assetUrl.startsWith('blob:') || assetUrl.startsWith('data:')) return assetUrl;
                                return `${APP.basePath}/f_rel/${uuid}/${assetUrl.split('/').pop()}`;
                            });
                            const mtlLoader = new THREE.MTLLoader(manager);
                            mtlLoader.load(mtlUrl, (materials) => {
                                if (isDisposed || !scene) return;
                                materials.preload();
                                const objLoader = new THREE.OBJLoader();
                                objLoader.setMaterials(materials);
                                const object = objLoader.parse(text);
                                scene.add(object);
                                centerAndScaleModel(object);
                            }, undefined, loadObjFallback);
                        } else {
                            loadObjFallback();
                        }
                    }).catch(() => {
                        if (!isDisposed && container) {
                            container.innerHTML = `<div style="color:red;padding:20px;">モデルの読み込みに失敗しました</div>`;
                        }
                    });
                } else if (ext === 'glb' || ext === 'gltf') {
                    const loader = new THREE.GLTFLoader();
                    loader.load(url, (gltf) => {
                        if (isDisposed || !scene) {
                            disposeObject3D(gltf.scene);
                            return;
                        }
                        scene.add(gltf.scene);
                        centerAndScaleModel(gltf.scene);
                    }, undefined, (error) => {
                        console.error(error);
                        if (!isDisposed && container) {
                            container.innerHTML = `<div style="color:red;padding:20px;">モデルの読み込みに失敗しました</div>`;
                        }
                    });
                }

                animate();
            }, 50);

            return '<div id="preview-3d-container" style="width:100%;height:100%;background:#f0f0f0;border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#333;">モデルデータを構築中...</div>';
        }
    };

    const handler = handlers[type];
    if (handler) {
        const result = handler();
        if (typeof result === 'string') content.innerHTML = result;

        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get('preview') !== uuid) {
            currentUrl.searchParams.set('preview', uuid);
            window.history.replaceState(null, '', currentUrl);
        }
    }
}

function closeModal() {
    cleanup3DPreview();
    currentCopyTextGetter = null;

    document.getElementById('preview-modal').classList.remove('active');
    document.getElementById('modal-content').innerHTML = '';
    const landscapeBtn = document.getElementById('landscape-btn');
    if (landscapeBtn) landscapeBtn.style.display = 'none';

    const saveBtn = document.getElementById('save-txt-btn');
    if (saveBtn) {
        saveBtn.style.display = 'none';
        saveBtn.dataset.uuid  = '';
    }

    const copyBtn = document.getElementById('copy-content-btn');
    if (copyBtn) {
        if (copyBtnResetTimer) {
            clearTimeout(copyBtnResetTimer);
            copyBtnResetTimer = null;
        }
        copyBtn.textContent   = 'コピー';
        copyBtn.style.display = 'none';
    }

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has('preview')) {
        currentUrl.searchParams.delete('preview');
        window.history.replaceState(null, '', currentUrl);
    }
}

async function saveTextFile() {
    const saveBtn  = document.getElementById('save-txt-btn');
    const uuid     = saveBtn.dataset.uuid;
    const textarea = document.getElementById('edit-text-area');
    if (!uuid || !textarea) return;

    const formData = new FormData();
    formData.append("uuid", uuid);
    formData.append("file", new Blob([textarea.value], { type: 'text/plain' }));

    try {
        const res = await fetch(`${APP.basePath}/update_file/`, { method: 'POST', body: formData });
        if (res.ok) {
            addMessage(MSG.success('ファイルを保存しました。'));
            closeModal();
            setTimeout(() => location.reload(), 500);
        } else {
            const errorData = await res.json().catch(() => ({}));
            addMessage(MSG.error(`保存に失敗しました: ${errorData.detail || ""}`));
        }
    } catch (err) {
        addMessage(MSG.error('通信エラーが発生しました。'));
    }
}

function toggleLandscape() {
    const videoEl = document.getElementById('preview-video-el');
    if (videoEl) videoEl.classList.toggle('landscape-mode');
}

// ---- Excel プレビュー ----------------------------------------
async function renderExcelPreview(uuid, content) {
    try {
        const [, infoRes] = await Promise.all([
            ensurePreviewLibraries('excel', 'xlsx'),
            fetch(`${APP.basePath}/excel/info/${uuid}`)
        ]);
        if (!infoRes.ok) throw new Error('シート情報の取得に失敗しました');
        const sheets = (await infoRes.json()).sheets || [];
        if (sheets.length === 0)
            return content.innerHTML = '<div style="padding:20px;">表示できるシートがありません。</div>';

        const displaySheets  = sheets.slice(0, 3);
        const remainingCount = sheets.length - displaySheets.length;

        content.innerHTML = `
        <div class="excel-preview-wrapper" style="display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;">
            <div class="excel-tabs">
                ${displaySheets.map((s, i) =>
                    `<div class="excel-tab ${i === 0 ? 'active' : ''}" data-uuid="${uuid}" data-sheet="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</div>`
                ).join('')}
                ${remainingCount > 0
                    ? `<div class="excel-tab disabled-tab" title="すべてのシートを確認するにはダウンロードしてください">...他${remainingCount}シート</div>`
                    : ''}
            </div>
            <div class="excel-sheet-container preview-csv-container" style="border:none;overflow:auto;flex-grow:1;" id="excel-sheet-container">
                <div style="padding:20px;">シートを読み込み中...</div>
            </div>
        </div>`;

        const tabsContainer = content.querySelector('.excel-tabs');
        if (tabsContainer) {
            tabsContainer.addEventListener('click', (e) => {
                const tab = e.target.closest('.excel-tab:not(.disabled-tab)');
                if (tab) switchExcelSheet(tab, tab.dataset.uuid, tab.dataset.sheet);
            });
        }

        await loadExcelSheet(uuid, displaySheets[0]);
    } catch (e) { content.innerHTML = previewError(e); }
}

async function switchExcelSheet(tabElement, uuid, sheetName) {
    if (tabElement.classList.contains('active') || tabElement.classList.contains('disabled-tab')) return;
    tabElement.closest('.excel-preview-wrapper').querySelectorAll('.excel-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');
    await loadExcelSheet(uuid, sheetName);
}

async function loadExcelSheet(uuid, sheetName) {
    const container = document.getElementById('excel-sheet-container');
    container.innerHTML = '<div style="padding:20px;">シートを読み込み中...</div>';
    try {
        const res = await fetch(`${APP.basePath}/excel/arrow/${uuid}?sheet=${encodeURIComponent(sheetName)}`);
        if (!res.ok) throw new Error('シートデータの取得に失敗しました');

        const table     = Arrow.tableFromIPC(await res.arrayBuffer());
        const fields    = table.schema.fields.map(f => f.name);
        const totalRows = table.numRows;
        const limit     = Math.min(totalRows, MAX_PREVIEW_ROWS);

        const rowHtmlList = [];
        for (let i = 0; i < limit; i++) {
            const row = table.get(i);
            rowHtmlList.push('<tr>' + fields.map(name => {
                const val = row[name];
                return `<td>${val !== null && val !== undefined ? Utils.escapeHtml(String(val)) : ''}</td>`;
            }).join('') + '</tr>');
        }

        const omittedNotice = totalRows > MAX_PREVIEW_ROWS
            ? `<div style="padding:10px;text-align:center;color:#555;background:#f5f5f5;border-top:1px solid #ddd;font-size:12px;">表示上限（${MAX_PREVIEW_ROWS.toLocaleString()}件）を超えたため、残り ${(totalRows - MAX_PREVIEW_ROWS).toLocaleString()} 件は省略されました。</div>`
            : '';

        container.innerHTML = '<table class="preview-csv"><thead><tr>' +
            fields.map(name => `<th>${Utils.escapeHtml(name)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rowHtmlList.join('') +
            '</tbody></table>' +
            omittedNotice;
    } catch (e) { content.innerHTML = previewError(e); }
}