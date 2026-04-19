
// ユーティリティ関数
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
            'pdf': '📕', 'md': '🎫', 'svg': '🎨', 'ico': '🎨',
            'csv': '📃', 'xls': '📊', 'xlsx': '📊', 'xlsm': '📊',
            'doc': '📝', 'docx': '📝', 'rtf': '📝',
            'ppt': '📑', 'pptx': '📑',
            'obj': '💎', 'mtl': '💎', 'stl': '💎',
            'py': '💻', 'js': '💻', 'html': '💻', 'css': '💻', 'java': '💻', 'cpp': '💻', 'c': '💻', 'ts': '💻',
            'json': '💻', 'xml': '💻', 'yaml': '💻', 'yml': '💻', 'sh': '💻',
            'db': '🗄️', 'sqlite': '🗄️', 'sqlite3': '🗄️', 'sql': '🗄️'
        };
        return icons[ext] || '📄';
    },
    escapeHtml: (unsafe) => {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
};

// メッセージ表示機能
function addMessage(htmlContent) {
    const path_div = document.getElementById('on_path');
    if (!path_div) return;

    if (APP.messageTimer) {
        clearTimeout(APP.messageTimer);
    } else {
        APP.originalContent = path_div.innerHTML;
    }

    if (window.innerWidth < 700) {
        path_div.innerHTML = `<div class="message-scroll-wrap"><div class="message-scroll-text">${htmlContent}</div></div>`;
    } else {
        path_div.innerHTML = htmlContent;
    }

    APP.messageTimer = setTimeout(() => {
        path_div.innerHTML = APP.originalContent;
        APP.messageTimer = null;
    }, 3500);
}

// ドラッグ＆ドロップ関連の処理を共通化
function setupDropZone(element, targetPathResolver) {
    if (!element) return;
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => element.addEventListener(evt, preventDefaults, false));

    element.addEventListener('dragover', (e) => {
        const folder = e.target.closest('.folder');
        if (folder) {
            element.classList.remove('drag-over');
            folder.classList.add('drag-over');
            document.querySelectorAll('.folder.drag-over').forEach(el => { if (el !== folder) el.classList.remove('drag-over'); });
        } else {
            element.classList.add('drag-over');
            document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    element.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !element.contains(e.relatedTarget)) {
            element.classList.remove('drag-over');
            document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    element.addEventListener('drop', (e) => {
        element.classList.remove('drag-over');
        document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));

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
        } catch(err) {}

        if (e.dataTransfer.items) {
            for (let item of e.dataTransfer.items) {
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) traverseFileTree(entry, targetPath);
                }
            }
        } else if (e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => executeUpload(file, targetPath));
        }
    });
}

// 初期化処理
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

    document.querySelectorAll('.file-size').forEach(el => el.textContent = `Size: ${Utils.formatBytes(parseInt(el.dataset.size, 10))}`);
    document.querySelectorAll('.file-icon').forEach(el => { if (el.dataset.filename) el.textContent = Utils.getFileIcon(el.dataset.filename); });

    setupDropZone(document.getElementById('detail'), e => {
        const folder = e.target.closest('.folder');
        return folder ? folder.getAttribute('data-path') : APP.currentPath;
    });
    setupDropZone(document.querySelector('.up-btn[data-path]'), e => e.currentTarget.getAttribute('data-path'));

    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.addEventListener('dragstart', (e) => {
            const li = e.target.closest('li.bulletin_board2:not(.folder)');
            if (li) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'internal_file',
                    uuid: li.dataset.uuid,
                    name: li.querySelector('.item-title')?.textContent || 'ファイル'
                }));
            } else {
                e.preventDefault(); 
            }
        });

        let clickCount = 0;
        let clickTimer = null;
        let lastTarget = null;
        
        fileList.addEventListener('click', (e) => {
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
                        addMessage('<span style="color: #ff0055;">このファイルは保護されているため、リンクをコピーできません。</span>');
                        return;
                    }
                    const uuid = li.dataset.uuid;
                    if (uuid) copyLinkToClipboard(uuid, li.querySelector('.item-title')?.textContent || 'ファイル');
                }
            }, 200);
        });
    }

    const previewModal = document.getElementById('preview-modal');
    if (previewModal) {
        previewModal.addEventListener('click', function(e) { if (e.target === this) closeModal(); });
        previewModal.addEventListener('touchend', function(e) { if (e.target === this) { e.preventDefault(); closeModal(); } });
    }

    const onPathDiv = document.getElementById('on_path');
    const searchInput = document.getElementById('search_input');
    const searchButton = document.getElementById('search_button');

    if (onPathDiv && searchInput) {
        const activateSearch = () => {
            if (APP.messageTimer) return;
            onPathDiv.style.display = 'none';
            searchInput.style.display = 'block';
            searchInput.focus();
        };

        onPathDiv.addEventListener('focus', activateSearch);
        
        // パンくずのクリックでは発火させないよう調整
        onPathDiv.addEventListener('click', (e) => {
            if (e.target.classList.contains('breadcrumb-item')) return;
            activateSearch();
        });

        searchInput.addEventListener('blur', () => {
            if (searchInput.value.trim() === '') {
                searchInput.style.display = 'none';
                onPathDiv.style.display = 'flex';
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
                onPathDiv.style.display = 'none';
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

    const urlParams = new URLSearchParams(window.location.search);
    const previewUuid = urlParams.get('preview');
    if (previewUuid) {
        const targetBtn = document.querySelector(`li[data-uuid="${previewUuid}"] .preview-btn`);
        if (targetBtn) {
            setTimeout(() => targetBtn.click(), 35);
        } else {
            addMessage('<span style="color: #ff0055;">指定されたプレビューファイルが見つかりません。</span>');
        }
    }
});

// ボタン処理
async function executeAdminTask(url, taskName) {
    if (!url || !APP.isAdmin) return addMessage('<span style="color: #ff0055;">管理者のみ実行可能</span>');
    if (APP.isProcessing) return;
    APP.isProcessing = true;
    try {
        const response = await fetch(url);
        const data = await response.json();
        addMessage(`<span style="color: #70c65b;">${taskName}: ${data.status}</span>`);
    } catch (error) {
        addMessage(`<span style="color: #ff0055;">エラーが発生しました。${error}</span>`);
    } finally {
        APP.isProcessing = false;
    }
}

const btn1 = () => executeAdminTask(APP.endpoints.dataFormatting, "Data解析");
const btn2 = () => executeAdminTask(APP.endpoints.apply, "データベース更新");
const btn3 = () => APP.endpoints.docs ? window.open(APP.endpoints.docs, '_blank') : addMessage('<span style="color: #ff0055;">管理者のみ実行可能</span>');

function navigate(path) { window.location.href = `${APP.basePath}/?path=${encodeURIComponent(path)}`; }

async function createFolder() {
    const folderName = prompt("新規フォルダ名を入力してください:");
    if (!folderName) return;
    const formData = new FormData();
    formData.append("path", APP.currentPath);
    formData.append("folder_name", folderName);
    try {
        const res = await fetch(`${APP.basePath}/mkdir/`, { method: "POST", body: formData });
        res.ok ? location.reload() : addMessage(`<span style="color: #ff0055;">フォルダの作成に失敗しました。</span>`);
    } catch (error) {
        addMessage(`<span style="color: #ff0055;">エラーが発生しました。${error}</span>`);
    }
}

function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput.files.length) return;
    Array.from(fileInput.files).forEach(file => executeUpload(file));
    fileInput.value = "";
}

function traverseFileTree(item, path = "") {
    if (item.isFile) {
        item.file(file => executeUpload(file, path));
    } else if (item.isDirectory) {
        const nextPath = path ? path + "/" + item.name : item.name;
        const dirReader = item.createReader();
        const readEntries = () => {
            dirReader.readEntries(entries => {
                if (entries.length > 0) {
                    entries.forEach(entry => traverseFileTree(entry, nextPath));
                    readEntries();
                }
            });
        };
        readEntries();
    }
}

function executeUpload(file, targetPath = APP.currentPath) {
    if (file.size > APP.currentRemainingCapacity) {
        alert(`【容量超過】\nストレージの空き容量が不足しています。\n\nファイル名: ${file.name}\nサイズ: ${Utils.formatBytes(file.size)}`);
        return;
    }

    APP.currentRemainingCapacity -= file.size;
    APP.activeUploads++;

    const formData = new FormData();
    formData.append("path", targetPath);
    formData.append("file", file);

    const fileList = document.getElementById('file-list');
    const uploadLi = document.createElement('li');
    uploadLi.className = 'bulletin_board2 upload-item none_selection';
    
    const displayPath = targetPath !== APP.currentPath ? targetPath.replace(APP.currentPath, "").replace(/^\//, "") + "/" : "";
    
    uploadLi.innerHTML = `
        <div class="upload-progress-bg"></div>
        <div class="item-icon">${Utils.getFileIcon(file.name)}</div>
        <div class="item-info">
            <div class="item-title">${Utils.escapeHtml(displayPath + file.name)}</div>
            <div class="item-meta"><span>Uploading...</span><span class="upload-percent" style="margin-left: 5px;">0%</span></div>
        </div>`;

    const statusMsg = fileList.querySelector('.status-message');
    if (statusMsg) statusMsg.style.display = 'none';
    fileList.insertBefore(uploadLi, fileList.firstChild);
    
    const progressBg = uploadLi.querySelector('.upload-progress-bg');
    const progressText = uploadLi.querySelector('.upload-percent');
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
            const percent = (event.loaded / event.total) * 100;
            progressBg.style.width = `${percent}%`;
            progressText.textContent = `${Math.floor(percent)}%`;
        }
    };

    xhr.onload = () => {
        APP.activeUploads--;
        if (xhr.status === 200) {
            if (APP.activeUploads === 0) location.reload();
        } else {
            APP.currentRemainingCapacity += file.size;
            uploadLi.remove();
            let errorMsg = "アップロードに失敗しました。";
            try { if (JSON.parse(xhr.responseText).detail) errorMsg = JSON.parse(xhr.responseText).detail; } catch(e) {}
            addMessage(`<span style="color: #ff0055;">${errorMsg}</span>`);
            if(APP.activeUploads === 0 && fileList.children.length === 0 && statusMsg) statusMsg.style.display = 'block';
        }
    };

    xhr.onerror = () => {
        APP.activeUploads--;
        APP.currentRemainingCapacity += file.size;
        uploadLi.remove();
        addMessage(`<span style="color: #ff0055;">通信エラーが発生しました。</span>`);
    };

    xhr.open('POST', `${APP.basePath}/upload/`, true);
    xhr.send(formData);
}

async function executeMove(uuid, filename, targetPath) {
    const formData = new FormData();
    formData.append("uuid", uuid);
    formData.append("filename", filename);
    formData.append("current_path", APP.currentPath);
    formData.append("target_path", targetPath);

    try {
        const res = await fetch(`${APP.basePath}/move/`, { method: "POST", body: formData });
        if (res.ok) {
            location.reload();
        } else {
            let errorMsg = '同名のファイルがあります。';
            try {
                const errRes = await res.json();
                if (errRes.detail) errorMsg = errRes.detail;
            } catch(e) {}
            addMessage(`<span style="color: #ff0055;">移動に失敗しました。理由: ${errorMsg}</span>`);
        }
    } catch (error) {
        addMessage(`<span style="color: #ff0055;">通信エラーが発生しました。</span>`);
    }
}

function showDeleteConfirm(buttonElement, path, name, isDir = false, itemCount = 0) {
    if (event) event.stopPropagation();

    const liElement = buttonElement.closest('li');
    if (liElement.querySelector('.delete-confirm-overlay')) return;

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
        if (isDir && itemCount > 0 && !confirm(`フォルダ「${name}」には ${itemCount} 個のアイテムが含まれています。\n完全に削除してよろしいですか？`)) {
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
            const handle = await window.showSaveFilePicker({ suggestedName: filename });
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
    a.href = url;
    a.download = filename; 
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function copyLinkToClipboard(uuid, filename) {
    const link = window.location.origin + APP.basePath + '/f/' + uuid;
    navigator.clipboard.writeText(link)
        .then(() => addMessage(`<span style="color: #0000cd;">${filename}のリンクをコピーしました</span>`))
        .catch(() => addMessage(`<span style="color: #ff0055;">${filename}のコピーに失敗しました</span>`));
}

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
        return addMessage(`<span style="color: #ff0055;">この${typeStr}は保護されています。</span>`);
    }

    const fullDisplayName = li.querySelector('.item-title').textContent;
    const isFolder = li.classList.contains('folder');
    
    let baseName = fullDisplayName;
    currentExt = '';

    if (!isFolder) {
        const lastDot = fullDisplayName.lastIndexOf('.');
        // .gitignoreなどの先頭ドットのみのケースを除外
        if (lastDot > 0) {
            baseName = fullDisplayName.substring(0, lastDot);
            currentExt = fullDisplayName.substring(lastDot);
        }
    }

    const tags = isFolder ? '' : Array.from(li.querySelectorAll('.item-tags span')).map(s => s.textContent.replace('#', '')).join(', ');

    currentEditingItem = {
        path: li.dataset.path,
        name: fullDisplayName,
        isFolder: isFolder
    };

    const modalTitle = document.getElementById('edit-modal-title');
    if (modalTitle) {
        modalTitle.textContent = fullDisplayName;
    }

    const nameInput = document.getElementById('edit-name-input');
    const extDisplay = document.getElementById('edit-ext-display');

    nameInput.value = baseName;
    extDisplay.textContent = currentExt;
    extDisplay.style.display = isFolder ? 'none' : 'inline';

    document.getElementById('edit-tags-input').value = tags;
    document.getElementById('edit-tags-group').style.display = isFolder ? 'none' : 'block';
    document.getElementById('edit-modal').style.display = 'flex';
    
    setTimeout(() => nameInput.focus(), 100);
}

async function saveItemChanges() {
    if (!currentEditingItem) return;

    const newBaseName = document.getElementById('edit-name-input').value.trim();
    const tags = document.getElementById('edit-tags-input').value.trim();

    if (!newBaseName) return alert("名前を入力してください。");

    // 本体名と保持していた拡張子を結合
    const finalName = newBaseName + currentExt;

    const formData = new FormData();
    formData.append("path", currentEditingItem.path);
    formData.append("new_name", finalName);
    formData.append("tags", tags);

    try {
        const res = await fetch(`${APP.basePath}/update_metadata/`, { method: "POST", body: formData });
        if (res.ok) {
            location.reload();
        } else {
            const data = await res.json();
            addMessage(`<span style="color: #ff0055;">${data.detail || "エラーが発生しました"}</span>`);
        }
    } catch (error) {
        addMessage('<span style="color: #ff0055;">通信エラーが発生しました。</span>');
    }
}

// モーダル外クリックで閉じる
window.addEventListener('click', (e) => {
    const modal = document.getElementById('edit-modal');
    if (e.target === modal) closeEditModal();
});

    function openPreview(filename, uuid, size, dateStr) {
    const ext = (filename.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    const typeMap = {
        'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'gif': 'image', 'bmp': 'image', 'webp': 'image',
        'svg': 'svg', 'mp4': 'video', 'webm': 'video', 'mov': 'video',
        'mp3': 'audio', 'wav': 'audio', 'm4a': 'audio', 'aac': 'audio', 'flac': 'audio', 'ogg': 'audio',
        'pdf': 'pdf', 'csv': 'csv', 'xlsx': 'excel', 'xls': 'excel', 'xlsm': 'excel', 'docx': 'word',
        'txt': 'text', 'py': 'text', 'html': 'text', 'css': 'text', 'js': 'text', 'json': 'text', 'log': 'text', 
        'md': 'markdown',
        'stl': '3d', 'obj': '3d'
    };

    const type = typeMap[ext] || 'unsupported';
    if (type === 'unsupported') return addMessage(`<span style="color: #ff0055;">${Utils.escapeHtml(filename)} はプレビュー非対応です。[DL]から確認してください。</span>`);

    const modal = document.getElementById('preview-modal');
    const content = document.getElementById('modal-content');
    const landscapeBtn = document.getElementById('landscape-btn');
    const url = `${APP.basePath}/f/${uuid}?inline=true`;

    document.getElementById('modal-title').textContent = filename;
    document.getElementById('modal-size').textContent = `Size: ${Utils.formatBytes(size)}`;
    if (document.getElementById('modal-date')) document.getElementById('modal-date').textContent = dateStr || '';
    if (landscapeBtn) landscapeBtn.style.display = 'none';
    
    content.innerHTML = '<div style="padding: 20px;">Loading...</div>';
    modal.classList.add('active');

    const handlers = {
        'image': () => `<img src="${url}" class="preview-image" alt="preview">`,
        'video': () => {
            if (landscapeBtn) landscapeBtn.style.display = 'block';
            return `<video id="preview-video-el" class="preview-video" playsinline autoplay loop onclick="this.setAttribute('controls', 'controls'); this.onclick=null;"><source src="${url}"></video>`;
        },
        'audio': async () => {
            let metaHtml = '';
            let displayTitle = Utils.escapeHtml(filename);
            let coverHtml = `<div class="preview-audio-icon">🎵</div>`;
            
            try {
                const res = await fetch(`${APP.basePath}/audio/meta/${uuid}`);
                if (res.ok) {
                    const meta = await res.json();
                    if (meta.title && meta.title !== 'Unknown' && meta.title !== filename) {
                        displayTitle = Utils.escapeHtml(meta.title);
                    }
                    
                    if (meta.has_cover) {
                        coverHtml = `<img src="${APP.basePath}/audio/cover/${uuid}" class="audio-cover-img" alt="cover">`;
                    }
                    
                    metaHtml = `
                        <div class="audio-artist">${Utils.escapeHtml(meta.artist)}</div>
                        <div class="audio-album">${Utils.escapeHtml(meta.album)}</div>
                        <div class="audio-tech">
                            <span>${Utils.escapeHtml(meta.duration)}</span>
                            ${meta.bitrate !== 'Unknown' ? `<span class="audio-dot">•</span><span>${Utils.escapeHtml(meta.bitrate)}</span>` : ''}
                        </div>
                    `;
                }
            } catch(e) {
                console.error('Failed to fetch audio metadata', e);
            }

            content.innerHTML = `
                <div class="preview-audio-wrapper">
                    <div class="audio-cover-container">
                        ${coverHtml}
                    </div>
                    <div class="audio-details">
                        <div class="audio-title">${displayTitle}</div>
                        ${metaHtml}
                    </div>
                    <audio class="modern-audio-player" controls autoplay muted loop><source src="${url}">お使いのブラウザはaudio要素をサポートしていません。</audio>
                </div>`;
        },
        'pdf': () => `<iframe src="${url}" style="width:100%; height:100%; border:none; background-color: #fff;"></iframe>`,
        'svg': async () => {
            content.innerHTML = '<div style="padding: 20px;">SVGを最適化しています...</div>';
            try {
                const response = await fetch(url);
                const svgText = await response.text();
                const svgEl = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
                if (svgEl && svgEl.tagName.toLowerCase() === 'svg') {
                    if (!svgEl.getAttribute('viewBox')) {
                        const w = svgEl.getAttribute('width'), h = svgEl.getAttribute('height');
                        if (w && h && !w.includes('%') && !h.includes('%')) svgEl.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
                    }
                    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                    Object.assign(svgEl.style, { width: '100%', height: '100%', maxHeight: '100%', display: 'block', margin: 'auto' });
                    
                    const containerId = 'svg-container-' + Date.now();
                    content.innerHTML = `<div id="${containerId}" style="width: 100%; height: 100%; background-color: #fff; overflow: auto; display: grid; place-items: center; box-sizing: border-box; border-radius: 4px; padding: 15px; opacity: 0; transition: opacity 0.2s ease;">${svgEl.outerHTML}</div>`;
                    
                    setTimeout(() => {
                        const container = document.getElementById(containerId);
                        if (container) container.style.opacity = '1';
                    }, 50);
                } else throw new Error("SVG parse failed");
            } catch (err) {
                content.innerHTML = `<div style="width: 100%; height: 100%; background-color: #fff; display: grid; place-items: center; overflow: auto; border-radius: 4px;"><img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain;"></div>`;
            }
        },
        'word': async () => {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const result = await mammoth.convertToHtml({arrayBuffer});
                content.innerHTML = `<div style="padding: 20px; background: #fff; width: 100%; height: 100%; overflow-y: auto; box-sizing: border-box; text-align: left; color: #333; line-height: 1.6;">${result.value}</div>`;
            } catch (err) { content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${err.message}</div>`; }
        },
        'text': async () => {
            try {
                const response = await fetch(url);
                content.innerHTML = `<pre class="preview-text">${Utils.escapeHtml(await response.text())}</pre>`;
            } catch (err) { content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${err.message}</div>`; }
        },
        // markdown用のハンドラーを追加
        'markdown': async () => {
            try {
                const response = await fetch(url);
                const text = await response.text();
                // markedでHTMLに変換し、DOMPurifyでサニタイズを実行
                const rawHtml = marked.parse(text);
                const cleanHtml = DOMPurify.sanitize(rawHtml);
                content.innerHTML = `<div class="preview-markdown">${cleanHtml}</div>`;
            } catch (err) { 
                content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${err.message}</div>`; 
            }
        },
        'csv': async () => {
            try {
                const response = await fetch(url);
                const rows = (await response.text()).split('\n');
                let html = '<div class="preview-csv-container"><table class="preview-csv">';
                rows.forEach((row, index) => {
                    if (!row.trim() && index === rows.length - 1) return;
                    html += '<tr>' + row.split(',').map(col => `<${index === 0 ? 'th' : 'td'}>${Utils.escapeHtml(col.trim())}</${index === 0 ? 'th' : 'td'}>`).join('') + '</tr>';
                });
                content.innerHTML = html + '</table></div>';
            } catch (err) { content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${err.message}</div>`; }
        },
        'excel': () => renderExcelPreview(uuid, content),
        '3d': () => {
            setTimeout(() => {
                const container = document.getElementById('preview-3d-container');
                if (!container) return;

                container.innerHTML = '';
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0xf0f0f0);

                const gridHelper = new THREE.GridHelper(100, 50, 0xaaaaaa, 0xdddddd);
                scene.add(gridHelper);

                const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);

                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setSize(container.clientWidth, container.clientHeight);
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.outputEncoding = THREE.sRGBEncoding;
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                renderer.toneMappingExposure = 0.8;
                container.appendChild(renderer.domElement);

                const controls = new THREE.OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;

                const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
                scene.add(ambientLight);

                const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.2);
                hemiLight.position.set(0, 20, 0);
                scene.add(hemiLight);

                const sunLight = new THREE.DirectionalLight(0xffffff, 0.4);
                sunLight.position.set(10, 20, 10);
                scene.add(sunLight);

                let animationId;
                const animate = function () {
                    if (!document.getElementById('preview-3d-container')) {
                        cancelAnimationFrame(animationId);
                        return;
                    }
                    animationId = requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                };

                window.addEventListener('resize', onWindowResize, false);
                function onWindowResize() {
                    if (!document.getElementById('preview-3d-container')) {
                        window.removeEventListener('resize', onWindowResize);
                        return;
                    }
                    camera.aspect = container.clientWidth / container.clientHeight;
                    camera.updateProjectionMatrix();
                    renderer.setSize(container.clientWidth, container.clientHeight);
                }

                const centerAndScaleModel = (object) => {
                    const box = new THREE.Box3().setFromObject(object);
                    const size = box.getSize(new THREE.Vector3()).length();
                    const center = box.getCenter(new THREE.Vector3());

                    object.position.x += (object.position.x - center.x);
                    object.position.y += (object.position.y - center.y);
                    object.position.z += (object.position.z - center.z);

                    const newNear = size / 100 || 0.1;
                    const newFar = size * 100 || 1000;
                    camera.near = newNear;
                    camera.far = newFar;
                    camera.updateProjectionMatrix();

                    camera.position.copy(center).add(new THREE.Vector3(0, size * 0.5, size * 2.0));
                    controls.maxDistance = size * 10;
                    controls.target.copy(center);
                };

                if (ext === 'stl') {
                    const loader = new THREE.STLLoader();
                    loader.load(url, function (geometry) {
                        const material = new THREE.MeshPhongMaterial({
                            color: geometry.hasColors ? 0xffffff : 0x999999,
                            specular: 0x111111,
                            shininess: 30,
                            vertexColors: geometry.hasColors
                        });
                        const mesh = new THREE.Mesh(geometry, material);
                        scene.add(mesh);
                        centerAndScaleModel(mesh);
                    });
                } else if (ext === 'obj') {
                    fetch(url).then(res => res.text()).then(text => {
                        const mtlMatch = text.match(/^mtllib\s+(.+)$/m);

                        const loadObjFallback = () => {
                            const objLoader = new THREE.OBJLoader();
                            const object = objLoader.parse(text);
                            object.traverse(function (child) {
                                if (child instanceof THREE.Mesh && (!child.material || !child.material.name)) {
                                    child.material = new THREE.MeshPhongMaterial({ color: 0x999999 });
                                }
                            });
                            scene.add(object);
                            centerAndScaleModel(object);
                        };

                        if (mtlMatch) {
                            const mtlFilename = mtlMatch[1].trim();
                            const mtlUrl = `${APP.basePath}/f_rel/${uuid}/${mtlFilename}`;

                            const manager = new THREE.LoadingManager();
                            manager.setURLModifier((assetUrl) => {
                                if (assetUrl.startsWith('blob:') || assetUrl.startsWith('data:')) return assetUrl;
                                const assetName = assetUrl.split('/').pop();
                                return `${APP.basePath}/f_rel/${uuid}/${assetName}`;
                            });

                            const mtlLoader = new THREE.MTLLoader(manager);
                            mtlLoader.load(mtlUrl, (materials) => {
                                materials.preload();
                                const objLoader = new THREE.OBJLoader();
                                objLoader.setMaterials(materials);
                                const object = objLoader.parse(text);
                                scene.add(object);
                                centerAndScaleModel(object);
                            }, undefined, () => {
                                loadObjFallback();
                            });
                        } else {
                            loadObjFallback();
                        }
                    }).catch(() => {
                        container.innerHTML = `<div style="color: red; padding: 20px;">モデルの読み込みに失敗しました</div>`;
                    });
                }
                
                animate();
            }, 50);
            
            return '<div id="preview-3d-container" style="width: 100%; height: 100%; background: #f0f0f0; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #333;">モデルデータを構築中...</div>';
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
    document.getElementById('preview-modal').classList.remove('active');
    document.getElementById('modal-content').innerHTML = ''; 
    const landscapeBtn = document.getElementById('landscape-btn');
    if (landscapeBtn) landscapeBtn.style.display = 'none';

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has('preview')) {
        currentUrl.searchParams.delete('preview');
        window.history.replaceState(null, '', currentUrl);
    }
}

function toggleLandscape() {
    const videoEl = document.getElementById('preview-video-el');
    if (videoEl) videoEl.classList.toggle('landscape-mode');
}

async function renderExcelPreview(uuid, content) {
    try {
        const infoRes = await fetch(`${APP.basePath}/excel/info/${uuid}`);
        if (!infoRes.ok) throw new Error('シート情報の取得に失敗しました');
        const sheets = (await infoRes.json()).sheets || [];

        if (sheets.length === 0) return content.innerHTML = '<div style="padding: 20px;">表示できるシートがありません。</div>';

        const displaySheets = sheets.slice(0, 3);
        const remainingCount = sheets.length - displaySheets.length;

        content.innerHTML = `
        <div class="excel-preview-wrapper">
            <div class="excel-tabs">
                ${displaySheets.map((s, i) => `<div class="excel-tab ${i === 0 ? 'active' : ''}" onclick="switchExcelSheet(this, '${uuid}', '${Utils.escapeHtml(s)}')">${Utils.escapeHtml(s)}</div>`).join('')}
                ${remainingCount > 0 ? `<div class="excel-tab disabled-tab" title="すべてのシートを確認するにはダウンロードしてください">...他${remainingCount}シート</div>` : ''}
            </div>
            <div class="excel-sheet-container preview-csv-container" style="border: none; border-radius: 0;" id="excel-sheet-container">
                <div style="padding: 20px;">シートを読み込み中...</div>
            </div>
        </div>`;
        await loadExcelSheet(uuid, displaySheets[0]);
    } catch (e) {
        content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
    }
}

async function switchExcelSheet(tabElement, uuid, sheetName) {
    if (tabElement.classList.contains('active') || tabElement.classList.contains('disabled-tab')) return;
    tabElement.closest('.excel-preview-wrapper').querySelectorAll('.excel-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');
    await loadExcelSheet(uuid, sheetName);
}

async function loadExcelSheet(uuid, sheetName) {
    const container = document.getElementById('excel-sheet-container');
    container.innerHTML = '<div style="padding: 20px;">シートを読み込み中...</div>';
    try {
        const res = await fetch(`${APP.basePath}/excel/arrow/${uuid}?sheet=${encodeURIComponent(sheetName)}`);
        if (!res.ok) throw new Error('シートデータの取得に失敗しました');
        
        const table = Arrow.tableFromIPC(await res.arrayBuffer());
        const fields = table.schema.fields.map(f => f.name);
        
        let html = '<table class="preview-csv"><thead><tr>' + fields.map(name => `<th>${Utils.escapeHtml(name)}</th>`).join('') + '</tr></thead><tbody>';
        for (let i = 0; i < table.numRows; i++) {
            const row = table.get(i);
            html += '<tr>' + fields.map(name => {
                const val = row[name];
                return `<td>${val !== null && val !== undefined ? Utils.escapeHtml(String(val)) : ''}</td>`;
            }).join('') + '</tr>';
        }
        container.innerHTML = html + '</tbody></table>';
    } catch (e) {
        container.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
    }
}