
    const currentPath = "{{ current_path }}";
    const basePath = "{{ prefix }}";
    
    const maxCapacity = Number("{{ max_capacity }}") || 0;
    const usedCapacity = Number("{{ used_capacity }}") || 0;
    const remainingCapacity = maxCapacity - usedCapacity;

    let currentRemainingCapacity = remainingCapacity;
    let activeUploads = 0;

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function getFileIcon(filename) {
        const extMatch = filename.match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : '';
        const icons = {
            'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'webp': '🖼️', 'svg': '🖼️', 'ico': '🖼️',
            'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'wmv': '🎬', 'flv': '🎬', 'mkv': '🎬', 'webm': '🎬',
            'mp3': '🎵', 'wav': '🎵', 'aac': '🎵', 'flac': '🎵', 'ogg': '🎵', 'm4a': '🎵',
            'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
            'pdf': '📕',
            'csv': '📃', 'xls': '📊', 'xlsx': '📊', 'xlsm': '📊',
            'doc': '📝', 'docx': '📝', 'rtf': '📝',
            'ppt': '📑', 'pptx': '📑',
            'py': '💻', 'js': '💻', 'html': '💻', 'css': '💻', 'java': '💻', 'cpp': '💻', 'c': '💻', 'ts': '💻',
            'json': '💻', 'xml': '💻', 'yaml': '💻', 'yml': '💻', 'sh': '💻',
            'db': '🗄️', 'sqlite': '🗄️', 'sqlite3': '🗄️', 'sql': '🗄️'
        };
        return icons[ext] || '📄';
    }

window.onload = () => {
    const capacityLabel = document.getElementById('capacity-label');
    const fillBar = document.getElementById('capacity-bar-fill');
    
    capacityLabel.textContent = `${formatBytes(usedCapacity)} / ${formatBytes(maxCapacity)}`;
    const capacityPercent = Math.min((usedCapacity / maxCapacity) * 100, 100);
    fillBar.style.width = `${capacityPercent}%`;
    
    if (capacityPercent > 90) {
        fillBar.style.backgroundColor = '#ff8282';
        fillBar.style.boxShadow = '0 0 10px #ff8282';
    }

    document.querySelectorAll('.file-size').forEach(el => {
        const size = parseInt(el.getAttribute('data-size'), 10);
        el.textContent = `Size: ${formatBytes(size)}`;
    });

    document.querySelectorAll('.file-icon').forEach(el => {
        const filename = el.getAttribute('data-filename');
        if (filename) el.textContent = getFileIcon(filename);
    });

    const detailArea = document.getElementById('detail');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        detailArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    detailArea.addEventListener('dragover', (e) => {
        const folder = e.target.closest('.folder');
        
        if (folder) {
            detailArea.classList.remove('drag-over');
            folder.classList.add('drag-over');
            
            document.querySelectorAll('.folder.drag-over').forEach(el => {
                if (el !== folder) el.classList.remove('drag-over');
            });
        } else {
            detailArea.classList.add('drag-over');
            document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    }, false);

    detailArea.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || !detailArea.contains(e.relatedTarget)) {
            detailArea.classList.remove('drag-over');
            document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    }, false);

    detailArea.addEventListener('drop', (e) => {
        detailArea.classList.remove('drag-over');
        document.querySelectorAll('.folder.drag-over').forEach(el => el.classList.remove('drag-over'));

        const folder = e.target.closest('.folder');
        const targetPath = folder ? folder.getAttribute('data-path') : currentPath;

        try {
            const dragDataStr = e.dataTransfer.getData('application/json');
            if (dragDataStr) {
                const dragData = JSON.parse(dragDataStr);
                if (dragData.type === 'internal_file') {
                    if (folder && targetPath !== currentPath) {
                        executeMove(dragData.uuid, dragData.name, targetPath);
                    }
                    return; 
                }
            }
        } catch(err) {
        }

        if (e.dataTransfer.items) {
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                const item = e.dataTransfer.items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        traverseFileTree(entry, targetPath);
                    }
                }
            }
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => executeUpload(file, targetPath));
        }
    });

    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.addEventListener('dragstart', (e) => {
            const li = e.target.closest('li.bulletin_board2:not(.folder)');
            if (li) {
                const uuid = li.getAttribute('data-uuid');
                const titleElement = li.querySelector('.item-title');
                const filename = titleElement ? titleElement.textContent : 'ファイル';
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'internal_file',
                    uuid: uuid,
                    name: filename
                }));
            } else {
                e.preventDefault(); 
            }
        });
    }

    const upBtn = document.querySelector('.up-btn[data-path]');
    if (upBtn) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            upBtn.addEventListener(eventName, preventDefaults, false);
        });

        upBtn.addEventListener('dragover', () => {
            upBtn.classList.add('drag-over');
        });

        upBtn.addEventListener('dragleave', () => {
            upBtn.classList.remove('drag-over');
        });

        upBtn.addEventListener('drop', (e) => {
            upBtn.classList.remove('drag-over');
            const targetPath = upBtn.getAttribute('data-path');

            try {
                const dragDataStr = e.dataTransfer.getData('application/json');
                if (dragDataStr) {
                    const dragData = JSON.parse(dragDataStr);
                    if (dragData.type === 'internal_file') {
                        executeMove(dragData.uuid, dragData.name, targetPath);
                        return; 
                    }
                }
            } catch(err) {
            }

            if (e.dataTransfer.items) {
                for (let i = 0; i < e.dataTransfer.items.length; i++) {
                    const item = e.dataTransfer.items[i];
                    if (item.kind === 'file') {
                        const entry = item.webkitGetAsEntry();
                        if (entry) {
                            traverseFileTree(entry, targetPath);
                        }
                    }
                }
            } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                Array.from(e.dataTransfer.files).forEach(file => executeUpload(file, targetPath));
            }
        });
    }
};

    function navigate(path) {
        window.location.href = `${basePath}/?path=${encodeURIComponent(path)}`;
    }

    async function createFolder() {
        const folderName = prompt("新規フォルダ名を入力してください:");
        if (!folderName) return;

        const formData = new FormData();
        formData.append("path", currentPath);
        formData.append("folder_name", folderName);

        try {
            const res = await fetch(`${basePath}/mkdir/`, { method: "POST", body: formData });
            if (res.ok) {
                location.reload();
            } else {
                alert("フォルダの作成に失敗しました。");
            }
        } catch (error) {
            console.error("Error:", error);
            alert("通信エラーが発生しました。");
        }
    }

    function uploadFile() {
        const fileInput = document.getElementById('fileInput');
        if (!fileInput.files.length) return;
        Array.from(fileInput.files).forEach(file => executeUpload(file));
        fileInput.value = "";
    }

    let isProcessing = false;
    let messageTimer = null;
    let originalContent = null;
    
    function addMessage(htmlContent) {
        const path_div = document.getElementById('on_path');
        if (!path_div) return;
    
        if (messageTimer) {
            clearTimeout(messageTimer);
        } else {
            originalContent = path_div.innerHTML;
        }
    
        path_div.innerHTML = htmlContent;
    
        messageTimer = setTimeout(() => {
            path_div.innerHTML = originalContent;
            messageTimer = null;
        }, 3000);
    }

{% if admin == 1 %}
        async function btn1() {
            if (isProcessing) return;
            isProcessing = true;
            try {
                const response = await fetch("{{ url_for('data_formatting') }}");
                const data = await response.json();
                addMessage(`<span style="color: #70c65b;">Data解析: ${data.status}</span>`);
            } catch (error) {
                addMessage(`<span style="color: #ff0055;">エラーが発生しました。${error}</span>`);
            } finally {
                isProcessing = false;
            }
        }

        async function btn2() {
            if (isProcessing) return;
            isProcessing = true;
            try {
                const response = await fetch("{{ url_for('apply') }}");
                const data = await response.json();
                addMessage(`<span style="color: #70c65b;">データベース更新: ${data.status}</span>`);
            } catch (error) {
                addMessage(`<span style="color: #ff0055;">エラーが発生しました。${error}</span>`);
            } finally {
                isProcessing = false;
            }
        }

        async function btn3() {
            window.open("{{ url_for('docs') }}", '_blank')
        }
{% elif admin == 2 %}
        async function btn1() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }

        async function btn2() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }

        async function btn3() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }
{% else %}
        async function btn1() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }

        async function btn2() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }

        async function btn3() {
            addMessage(`<span style="color: #ff0055;">管理者のみ実行可能</span>`);
        }
{% endif %}

    function traverseFileTree(item, path) {
    path = path || "";
    if (item.isFile) {
        item.file(file => {
            executeUpload(file, path);
        });
    } else if (item.isDirectory) {
        let nextPath = path ? path + "/" + item.name : item.name;
        let dirReader = item.createReader();
        let readEntries = () => {
            dirReader.readEntries(entries => {
                if (entries.length > 0) {
                    for (let i = 0; i < entries.length; i++) {
                        traverseFileTree(entries[i], nextPath);
                    }
                    readEntries();
                }
            });
        };
        readEntries();
    }
}

function executeUpload(file, targetPath = currentPath) {
    if (file.size > currentRemainingCapacity) {
        alert(`【容量超過】\nストレージの空き容量が不足しています。\n\nファイル名: ${file.name}\nサイズ: ${formatBytes(file.size)}`);
        return;
    }

    currentRemainingCapacity -= file.size;
    activeUploads++;

    const formData = new FormData();
    formData.append("path", targetPath);
    formData.append("file", file);

    const fileList = document.getElementById('file-list');
    const uploadLi = document.createElement('li');
    uploadLi.className = 'bulletin_board2 upload-item none_selection';
    
    const progressBg = document.createElement('div');
    progressBg.className = 'upload-progress-bg';
    
    const itemIcon = document.createElement('div');
    itemIcon.className = 'item-icon';
    itemIcon.textContent = getFileIcon(file.name);

    const itemInfo = document.createElement('div');
    itemInfo.className = 'item-info';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'item-title';
    
    let displayPath = "";
    if (targetPath !== currentPath) {
        displayPath = targetPath.replace(currentPath, "").replace(/^\//, "") + "/";
    }
    titleDiv.textContent = displayPath + file.name;
    
    const metaDiv = document.createElement('div');
    metaDiv.className = 'item-meta';
    metaDiv.innerHTML = `<span>Uploading...</span><span class="upload-percent" style="margin-left: 5px;">0%</span>`;

    itemInfo.appendChild(titleDiv);
    itemInfo.appendChild(metaDiv);
    uploadLi.appendChild(progressBg);
    uploadLi.appendChild(itemIcon);
    uploadLi.appendChild(itemInfo);

    const statusMsg = fileList.querySelector('.status-message');
    if (statusMsg) statusMsg.style.display = 'none';
    fileList.insertBefore(uploadLi, fileList.firstChild);
    
    const progressText = uploadLi.querySelector('.upload-percent');
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            progressBg.style.width = `${percentComplete}%`;
            progressText.textContent = `${Math.floor(percentComplete)}%`;
        }
    };

    xhr.onload = () => {
        activeUploads--;
        if (xhr.status === 200) {
            if (activeUploads === 0) location.reload();
        } else {
            currentRemainingCapacity += file.size;
            uploadLi.remove();
            if(activeUploads === 0 && fileList.children.length === 0 && statusMsg) statusMsg.style.display = 'block';
        }
    };

    xhr.onerror = () => {
        activeUploads--;
        currentRemainingCapacity += file.size;
        uploadLi.remove();
    };

    xhr.open('POST', `${basePath}/upload/`, true);
    xhr.send(formData);
}

    async function executeMove(uuid, filename, targetPath) {
        const formData = new FormData();
        formData.append("uuid", uuid);
        formData.append("filename", filename);
        formData.append("current_path", currentPath);
        formData.append("target_path", targetPath);

        try {
            const res = await fetch(`${basePath}/move/`, { method: "POST", body: formData });
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
            console.error("Error:", error);
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

        const textSpan = document.createElement('span');
        textSpan.className = 'delete-confirm-text';
        textSpan.textContent = message;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'delete-confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            overlay.remove();
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn';
        confirmBtn.textContent = '削除';
        confirmBtn.onclick = (e) => {
            e.stopPropagation();
            if (isDir && itemCount > 0) {
                if (!confirm(`フォルダ「${name}」には ${itemCount} 個のアイテムが含まれています。\n完全に削除してよろしいですか？`)) {
                    overlay.remove();
                    return;
                }
            }
            executeDelete(path);
        };

        actionsDiv.appendChild(confirmBtn);
        actionsDiv.appendChild(cancelBtn);
        
        overlay.appendChild(textSpan);
        overlay.appendChild(actionsDiv);
        
        overlay.onclick = (e) => e.stopPropagation();
        liElement.appendChild(overlay);
    }

    async function executeDelete(path) {
        try {
            const res = await fetch(`${basePath}/delete/?path=${encodeURIComponent(path)}`, { method: "DELETE" });
            if (res.ok) {
                location.reload();
            } else {
                alert("削除に失敗しました。");
            }
        } catch (error) {
            console.error("Error:", error);
            alert("通信エラーが発生しました。");
        }
    }
    
    async function downloadFile(uuid, filename) {
        const url = `${basePath}/f/${uuid}`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename
                });
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
        document.body.removeChild(a);
    }

    function copyLinkToClipboard(uuid, filename) {
        const link = window.location.origin + basePath + '/f/' + uuid;
        navigator.clipboard.writeText(link).then(() => {
            addMessage(`<span style="color: #0000cd;">${filename}のリンクをコピーしました</span>`);
        }).catch(() => {
            addMessage(`<span style="color: #ff0055;">${filename}のコピーに失敗しました</span>`);
        });
    }

    let clickCount = 0;
    let clickTimer = null;
    let lastTarget = null;

    document.addEventListener('DOMContentLoaded', () => {
        const fileList = document.getElementById('file-list');
        if (!fileList) return;

        fileList.addEventListener('click', (e) => {
            const targetTag = e.target.tagName;
            if (targetTag === 'BUTTON' || targetTag === 'A' || e.target.closest('.item-actions')) return;
            
            const li = e.target.closest('li.bulletin_board2:not(.upload-item)');
            if (!li) return;

            if (window.getSelection().toString().length > 0) return;

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

                if (count === 1) {
                    if (li.classList.contains('folder')) {
                        const path = li.getAttribute('data-path');
                        if (path) navigate(path);
                    }
                } else if (count === 2) {
                    if (!li.classList.contains('folder')) {
                        const uuid = li.getAttribute('data-uuid');
                        const titleElement = li.querySelector('.item-title');
                        const filename = titleElement ? titleElement.textContent : 'ファイル';
                        if (uuid) copyLinkToClipboard(uuid, filename);
                    }
                }
            }, 200);
        });
    });

    async function executeRenamePrompt(li) {
        if (li.getAttribute('data-protected') === 'true') {
            addMessage('<span style="color: #ff0055;">このファイルは保護されているため、名前を変更できません。</span>');
            return;
        }

        const isFolder = li.classList.contains('folder');
        const titleElement = li.querySelector('.item-title');
        const currentFullName = titleElement.textContent;
        
        let currentName = currentFullName;
        let extension = "";

        if (!isFolder) {
            const lastDotIndex = currentFullName.lastIndexOf('.');
            if (lastDotIndex > 0) {
                currentName = currentFullName.substring(0, lastDotIndex);
                extension = currentFullName.substring(lastDotIndex);
            }
        }

        const newNameInput = prompt(`新しい名前を入力してください\n(現在の名前: ${currentFullName})`, currentName);
        if (!newNameInput || newNameInput === currentName) return;

        const finalNewName = isFolder ? newNameInput : newNameInput + extension;
        const itemPath = li.getAttribute('data-path');

        const formData = new FormData();
        formData.append("path", itemPath);
        formData.append("new_name", finalNewName);

        try {
            const res = await fetch(`${basePath}/rename/`, { method: "POST", body: formData });
            if (res.ok) {
                location.reload();
            } else {
                let errorMsg = "変更に失敗しました。";
                try {
                    const data = await res.json();
                    if (data.detail) errorMsg = data.detail;
                } catch(e) {}
                addMessage(`<span style="color: #ff0055;">${errorMsg}</span>`);
            }
        } catch (error) {
            addMessage('<span style="color: #ff0055;">通信エラーが発生しました。</span>');
        }
    }

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function openPreview(filename, uuid, size, dateStr) {
        const extMatch = filename.match(/\.([^.]+)$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : '';

        const typeMap = {
            'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'gif': 'image', 'bmp': 'image', 'webp': 'image',
            'svg': 'svg',
            'mp4': 'video', 'webm': 'video', 'mov': 'video',
            'mp3': 'audio', 'wav': 'audio', 'm4a': 'audio', 'aac': 'audio',
            'pdf': 'pdf',
            'csv': 'csv',
            'xlsx': 'excel', 'xls': 'excel', 'xlsm': 'excel',
            'docx': 'word',
            'txt': 'text', 'py': 'text', 'html': 'text', 'css': 'text', 'js': 'text', 'json': 'text', 'log': 'text', 'md': 'text'
        };

        const type = typeMap[ext] || 'unsupported';

        if (type === 'unsupported') {
            addMessage(`<span style="color: #ff0055;">${escapeHtml(filename)} はプレビュー非対応です。[DL]から確認してください。</span>`);
            return;
        }

        const modal = document.getElementById('preview-modal');
        const title = document.getElementById('modal-title');
        const content = document.getElementById('modal-content');
        const modalSize = document.getElementById('modal-size');
        const modalDate = document.getElementById('modal-date');
        const landscapeBtn = document.getElementById('landscape-btn');
        const url = `${basePath}/f/${uuid}?inline=true`;

        title.textContent = filename;
        modalSize.textContent = `Size: ${formatBytes(size)}`;
        if (modalDate) modalDate.textContent = dateStr ? dateStr : '';
        if (landscapeBtn) landscapeBtn.style.display = 'none';
        
        content.innerHTML = '<div style="padding: 20px;">Loading...</div>';
        modal.classList.add('active');

        if (type === 'image') {
            content.innerHTML = `<img src="${url}" class="preview-image" alt="preview">`;
        } else if (type === 'svg') {
            content.innerHTML = '<div style="padding: 20px;">SVGを最適化しています...</div>';
            
            fetch(url)
                .then(response => response.text())
                .then(svgText => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(svgText, "image/svg+xml");
                    const svgEl = doc.documentElement;

                    if (svgEl && svgEl.tagName.toLowerCase() === 'svg') {
                        let originalVb = svgEl.getAttribute('viewBox');
                        let w = svgEl.getAttribute('width');
                        let h = svgEl.getAttribute('height');

                        let needsBBoxCalculation = false;

                        if (!originalVb) {
                            if (w && h && !w.includes('%') && !h.includes('%')) {
                                svgEl.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
                            } else {
                                needsBBoxCalculation = true;
                            }
                        }

                        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                        svgEl.setAttribute('width', '100%');
                        svgEl.setAttribute('height', '100%');
                        svgEl.style.width = '100%';
                        svgEl.style.height = '100%';
                        svgEl.style.maxHeight = '100%';
                        svgEl.style.display = 'block';
                        svgEl.style.margin = 'auto';

                        const containerId = 'svg-container-' + Date.now();

                        content.innerHTML = `
                            <div id="${containerId}" style="width: 100%; height: 100%; background-color: #fff; overflow: auto; display: grid; place-items: center; box-sizing: border-box; border-radius: 4px; padding: 15px; opacity: 0; transition: opacity 0.2s ease;">
                                ${svgEl.outerHTML}
                            </div>
                        `;

                        const container = document.getElementById(containerId);
                        const renderedSvg = container.querySelector('svg');

                        setTimeout(() => {
                            if (needsBBoxCalculation && renderedSvg) {
                                try {
                                    const bbox = renderedSvg.getBBox();
                                    if (bbox && bbox.width > 0 && bbox.height > 0) {
                                        renderedSvg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
                                    }
                                } catch(e) {
                                    console.warn("SVG面積の計算エラー:", e);
                                }
                            }
                            if (container) {
                                container.style.opacity = '1';
                            }
                        }, 50);

                    } else {
                        throw new Error("SVG parse failed");
                    }
                })
                .catch(err => {
                    console.error("SVG Fallback:", err);
                    content.innerHTML = `
                        <div style="width: 100%; height: 100%; background-color: #fff; display: grid; place-items: center; overflow: auto; border-radius: 4px;">
                            <img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
                        </div>
                    `;
                });
        } else if (type === 'video') {
            content.innerHTML = `<video id="preview-video-el" class="preview-video" playsinline autoplay loop onclick="this.setAttribute('controls', 'controls'); this.onclick=null;"><source src="${url}"></video>`;
            if (landscapeBtn) landscapeBtn.style.display = 'block';
        } else if (type === 'audio') {
            content.innerHTML = `
                <div class="preview-audio-container">
                    <div class="preview-audio-icon">🎵</div>
                    <div class="preview-audio-title">${escapeHtml(filename)}</div>
                    <audio class="preview-audio" controls>
                        <source src="${url}">
                    </audio>
                </div>`;
        } else if (type === 'pdf') {
            content.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none; background-color: #fff;"></iframe>`;
        } else if (type === 'word') {
            fetch(url)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => mammoth.convertToHtml({arrayBuffer: arrayBuffer}))
                .then(result => {
                    content.innerHTML = `<div style="padding: 20px; background: #fff; width: 100%; height: 100%; overflow-y: auto; box-sizing: border-box; text-align: left; color: #333; line-height: 1.6;">${result.value}</div>`;
                })
                .catch(err => {
                    content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${err.message}</div>`;
                });
        } else if (type === 'text') {
            fetch(url).then(r => r.text()).then(text => {
                content.innerHTML = `<pre class="preview-text">${escapeHtml(text)}</pre>`;
            }).catch(e => {
                content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
            });
        } else if (type === 'csv') {
            fetch(url).then(r => r.text()).then(text => {
                let html = '<div class="preview-csv-container"><table class="preview-csv">';
                const rows = text.split('\n');
                rows.forEach((row, index) => {
                    if (!row.trim() && index === rows.length - 1) return;
                    const cols = row.split(',');
                    html += '<tr>';
                    cols.forEach(col => {
                        const tag = index === 0 ? 'th' : 'td';
                        html += `<${tag}>${escapeHtml(col.trim())}</${tag}>`;
                    });
                    html += '</tr>';
                });
                html += '</table></div>';
                content.innerHTML = html;
            }).catch(e => {
                content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
            });
        } else if (type === 'excel') {
            renderExcelPreview(uuid, content);
        }
    }

    function closeModal() {
        document.getElementById('preview-modal').classList.remove('active');
        document.getElementById('modal-content').innerHTML = ''; 
        const landscapeBtn = document.getElementById('landscape-btn');
        if (landscapeBtn) landscapeBtn.style.display = 'none';
    }

    function toggleLandscape() {
        const videoEl = document.getElementById('preview-video-el');
        if (videoEl) {
            videoEl.classList.toggle('landscape-mode');
        }
    }

    const previewModal = document.getElementById('preview-modal');
    
    previewModal.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });

    previewModal.addEventListener('touchend', function(e) {
        if (e.target === this) {
            e.preventDefault(); 
            closeModal();
        }
    });

    async function renderExcelPreview(uuid, content) {
        try {
            const infoRes = await fetch(`${basePath}/excel/info/${uuid}`);
            if (!infoRes.ok) throw new Error('シート情報の取得に失敗しました');
            const info = await infoRes.json();
            const sheets = info.sheets || [];

            if (sheets.length === 0) {
                content.innerHTML = '<div style="padding: 20px;">表示できるシートがありません。</div>';
                return;
            }

            const displaySheets = sheets.slice(0, 3);
            const remainingCount = sheets.length - displaySheets.length;

            let html = `
            <div class="excel-preview-wrapper">
                <div class="excel-tabs">
                    ${displaySheets.map((s, i) => `<div class="excel-tab ${i === 0 ? 'active' : ''}" onclick="switchExcelSheet(this, '${uuid}', '${escapeHtml(s)}')">${escapeHtml(s)}</div>`).join('')}
                    ${remainingCount > 0 ? `<div class="excel-tab disabled-tab" title="すべてのシートを確認するにはダウンロードしてください">...他${remainingCount}シート</div>` : ''}
                </div>
                <div class="excel-sheet-container preview-csv-container" style="border: none; border-radius: 0;" id="excel-sheet-container">
                    <div style="padding: 20px;">シートを読み込み中...</div>
                </div>
            </div>`;
            content.innerHTML = html;

            await loadExcelSheet(uuid, displaySheets[0]);

        } catch (e) {
            content.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
        }
    }

    async function switchExcelSheet(tabElement, uuid, sheetName) {
        if (tabElement.classList.contains('active') || tabElement.classList.contains('disabled-tab')) return;

        const wrapper = tabElement.closest('.excel-preview-wrapper');
        wrapper.querySelectorAll('.excel-tab').forEach(t => t.classList.remove('active'));
        tabElement.classList.add('active');

        await loadExcelSheet(uuid, sheetName);
    }

    async function loadExcelSheet(uuid, sheetName) {
        const container = document.getElementById('excel-sheet-container');
        container.innerHTML = '<div style="padding: 20px;">シートを読み込み中...</div>';

        try {
            const res = await fetch(`${basePath}/excel/arrow/${uuid}?sheet=${encodeURIComponent(sheetName)}`);
            if (!res.ok) throw new Error('シートデータの取得に失敗しました');
            
            const arrayBuffer = await res.arrayBuffer();
            const table = Arrow.tableFromIPC(arrayBuffer);

            let html = '<table class="preview-csv"><thead><tr>';
            const fields = table.schema.fields.map(f => f.name);
            
            fields.forEach(name => {
                html += `<th>${escapeHtml(name)}</th>`;
            });
            html += '</tr></thead><tbody>';

            for (let i = 0; i < table.numRows; i++) {
                html += '<tr>';
                const row = table.get(i);
                fields.forEach(name => {
                    const val = row[name];
                    html += `<td>${val !== null && val !== undefined ? escapeHtml(String(val)) : ''}</td>`;
                });
                html += '</tr>';
            }
            html += '</tbody></table>';

            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<div style="padding: 20px; color: red;">エラーが発生しました: ${e.message}</div>`;
        }
    }