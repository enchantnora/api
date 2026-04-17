document.addEventListener('DOMContentLoaded', () => {
    const calcHtml = `
        <input type="radio" id="normal_calc" class="calc_type" name="calc_type" checked>
        <input type="radio" id="time_calc" class="calc_type" name="calc_type">
        ※ 入力順に計算されます
        <div id="normal_monitor" class="monitor">0</div>
        <div id="button_type">
            <span class="num" onclick="calc(this)">1</span>
            <span class="num" onclick="calc(this)">2</span>
            <span class="num" onclick="calc(this)">3</span>
            <span class="num" onclick="calc(this)">4</span>
            <span class="num" onclick="calc(this)">5</span>
            <span class="num" onclick="calc(this)">6</span>
            <span class="num" onclick="calc(this)">7</span>
            <span class="num" onclick="calc(this)">8</span>
            <span class="num" onclick="calc(this)">9</span>
            <span class="num" onclick="calc(this)">0</span>
            <span class="point" onclick="calc(this)">.</span>
            <span class="ope" onclick="calc(this)">÷</span>
            <span class="ope" onclick="calc(this)">×</span>
            <span class="ope" onclick="calc(this)">－</span>
            <span class="ope" onclick="calc(this)">＋</span>
            <span class="calculate" onclick="calc(this)">＝</span>
            <span class="bs" onclick="calc(this)">←</span>
            <span class="clear font_s" onclick="calc(this)">AC</span>
            <label for="normal_calc" class="fx font_s label_normal">通常計算</label>
            <label for="time_calc" class="fx font_s label_time">時間計算</label>
        </div>
        <div id="time_monitor" class="monitor">0</div>
        <div id="button_type2">
            <span class="num" onclick="calcTime(this)">1</span>
            <span class="num" onclick="calcTime(this)">2</span>
            <span class="num" onclick="calcTime(this)">3</span>
            <span class="num" onclick="calcTime(this)">4</span>
            <span class="num" onclick="calcTime(this)">5</span>
            <span class="num" onclick="calcTime(this)">6</span>
            <span class="num" onclick="calcTime(this)">7</span>
            <span class="num" onclick="calcTime(this)">8</span>
            <span class="num" onclick="calcTime(this)">9</span>
            <span class="num" onclick="calcTime(this)">0</span>
            <span class="point" onclick="calcTime(this)">.</span>
            <span class="ope" onclick="calcTime(this)">÷</span>
            <span class="ope" onclick="calcTime(this)">×</span>
            <span class="ope" onclick="calcTime(this)">－</span>
            <span class="ope" onclick="calcTime(this)">＋</span>
            <span class="calculate" onclick="calcTime(this)">＝</span>
            <span class="bs" onclick="calcTime(this)">←</span>
            <span class="clear font_s" onclick="calcTime(this)">AC</span>
            <label for="normal_calc" class="fx font_s label_normal">通常計算</label>
            <label for="time_calc" class="fx font_s label_time">時間計算</label>
            <span class="now_time disabled" onclick="calcTime(this)">＋現在時間</span>
            <span class="time_unit font_s" onclick="calcTime(this)">秒</span>
            <span class="time_unit font_s" onclick="calcTime(this)">分</span>
            <span class="time_unit font_s" onclick="calcTime(this)">時</span>
            <span class="time_unit font_s" onclick="calcTime(this)">日</span>
        </div>
    `;

    const calcRay = document.getElementById('calc_ray');
    if (calcRay) {
        calcRay.innerHTML = calcHtml;
    }

    class Calculator {
        constructor() {
            this.display = document.getElementById('normal_monitor');
            this.operatorMap = { '＋': '+', '－': '-', '×': '*', '÷': '/' };
            this.clear();
        }
        clear() { this.display.textContent = '0'; this.error = false; }
        showErr() { this.display.textContent = 'Error'; this.error = true; }
        del() { if (this.error) this.clear(); else this.display.textContent = this.display.textContent.slice(0, -1) || '0'; }
        removeComma() { this.display.textContent = this.display.textContent.replace(/,/g, ""); }
        
        append(val, replaceOp = false) {
            if (this.error) this.clear();
            if (replaceOp && /[+\-*/]/.test(this.display.textContent.slice(-1))) {
                this.display.textContent = this.display.textContent.slice(0, -1) + val;
            } else {
                this.display.textContent = this.display.textContent === '0' ? val : this.display.textContent + val;
            }
            this.display.scrollLeft = this.display.scrollWidth;
        }
        
        calculate() {
            if (this.error) this.clear();
            try {
                const tokens = this.display.textContent.match(/(\d+(\.\d+)?|[+\-*/])/g);
                if (!tokens) return;
                let res = parseFloat(tokens[0]);
                for (let i = 1; i < tokens.length; i += 2) {
                    const next = parseFloat(tokens[i + 1]);
                    switch (tokens[i]) {
                        case '+': res += next; break; case '-': res -= next; break;
                        case '*': res *= next; break; case '/': res /= next; break;
                    }
                }
                if (isFinite(res)) { this.display.textContent = res.toLocaleString(); this.display.scrollLeft = 0; }
                else this.showErr();
            } catch { this.showErr(); }
        }
    }

    class TimeCalculator {
        constructor() {
            this.display = document.getElementById('time_monitor');
            this.operatorMap = { '＋': '+', '－': '-', '×': '*', '÷': '/' };
            this.clear();
        }
        clear() { 
            this.display.textContent = '0'; 
            this.error = false; 
            // 現在時間が表示されているかどうかのフラグをリセット
            this.isDateTimeDisplayed = false; 
        }
        showErr() { this.display.textContent = 'Error'; this.error = true; }
        del() { if (this.error) this.clear(); else this.display.textContent = this.display.textContent.slice(0, -1) || '0'; }

        append(val, replaceOp = false) {
            if (this.error) this.clear();
            if (replaceOp && /[+\-*/]/.test(this.display.textContent.slice(-1))) {
                this.display.textContent = this.display.textContent.slice(0, -1) + val;
            } else {
                if (this.display.textContent === '0' && !/[日時分秒+\-*/.]/.test(val)) {
                    this.display.textContent = val;
                } else {
                    this.display.textContent += val;
                }
            }
            this.display.scrollLeft = this.display.scrollWidth;
        }

        parseTime(str) {
                    if (!/[日時分秒]/.test(str)) return parseFloat(str) || 0;
                    let sec = 0;
                    const matches = str.match(/(\d+(\.\d+)?)([日時分秒]?)/g);
                    if (matches) {
                        matches.forEach(match => {
                            if (!match) return;
                            const valMatch = match.match(/\d+(\.\d+)?/);
                            if (!valMatch) return;
                            const val = parseFloat(valMatch[0]);
                            
                            if (match.includes('日')) sec += val * 86400;
                            else if (match.includes('時')) sec += val * 3600;
                            else if (match.includes('分')) sec += val * 60;
                            else sec += val;
                        });
                    }
                    return sec;
                }

        formatTime(sec) {
            if (!isFinite(sec)) throw new Error("Invalid");
            if (sec < 0) return '-' + this.formatTime(-sec);
            if (sec === 0) return '0';
            
            let d = Math.floor(sec / 86400); sec %= 86400;
            let h = Math.floor(sec / 3600); sec %= 3600;
            let m = Math.floor(sec / 60); sec %= 60;
            let s = Math.round(sec * 1000) / 1000;
            
            let res = '';
            if (d > 0) res += d + '日';
            if (h > 0) res += h + '時';
            if (m > 0) res += m + '分';
            if (s > 0) res += s + '秒';
            
            return res === '' ? '0' : res;
        }

    calculate() {
                if (this.error) this.clear();
                try {
                    const tokens = this.display.textContent.match(/((\d+(\.\d+)?[日時分秒]*)+|[+\-*/])/g);
                    if (!tokens) return;
    
                    let res = this.parseTime(tokens[0]);
                    // 最初に入力された値が時間（単位あり）かどうかを判定
                    let isTimeResult = /[日時分秒]/.test(tokens[0]);
    
                    for (let i = 1; i < tokens.length; i += 2) {
                        const nextStr = tokens[i + 1];
                        const next = this.parseTime(nextStr);
                        const nextIsTime = /[日時分秒]/.test(nextStr);
    
                        switch (tokens[i]) {
                            case '+': 
                                res += next; 
                                isTimeResult = isTimeResult || nextIsTime;
                                break;
                            case '-': 
                                res -= next; 
                                isTimeResult = isTimeResult || nextIsTime;
                                break;
                            case '*': 
                                res *= next; 
                                isTimeResult = isTimeResult || nextIsTime;
                                break;
                            case '/': 
                                res /= next; 
                                if (isTimeResult && nextIsTime) {
                                    // 時間 ÷ 時間 の場合は単位が相殺されて「純粋な数値」になる
                                    isTimeResult = false; 
                                } else {
                                    isTimeResult = isTimeResult || nextIsTime;
                                }
                                break;
                        }
                    }
    
                    if (isTimeResult) {
                        // 結果が時間の場合は通常通りフォーマットして表示
                        this.display.textContent = this.formatTime(res);
                    } else {
                        // 単位のない純粋な数値（比率など）の場合はそのまま表示（小数第3位程度で丸める）
                        this.display.textContent = (Math.round(res * 1000) / 1000).toString();
                    }
                    this.display.scrollLeft = 0;
                } catch {
                    this.showErr();
                }
            }
    }

    const calcInstance = new Calculator();
    const timeCalcInstance = new TimeCalculator();
    
    function updateTimeOperatorsState() {
        const displayStr = timeCalcInstance.display.textContent;
        // 現在時刻が表示されている間は四則演算子も無効化を維持する
        const isEnabled = /[日時分秒+\-*/]$/.test(displayStr) && !timeCalcInstance.isDateTimeDisplayed;
        const opes = document.querySelectorAll('#button_type2 .ope');
        opes.forEach(ope => {
            if (isEnabled) {
                ope.classList.remove('disabled');
            } else {
                ope.classList.add('disabled');
            }
        });
    }

    updateTimeOperatorsState();
    
    window.calc = function(btn) {
        const v = btn.textContent;
        calcInstance.removeComma();
        if (v === 'AC') calcInstance.clear();
        else if (v === '←') calcInstance.del();
        else if (v === '＝') { if (!/[+\-*/.]/.test(calcInstance.display.textContent.slice(-1))) calcInstance.calculate(); }
        else if (['＋','－','×','÷'].includes(v)) calcInstance.append(calcInstance.operatorMap[v], true);
        else if (v === '.') { if (!calcInstance.display.textContent.split(/[+\-*/]/).pop().includes('.')) calcInstance.append('.'); }
        else if (!isNaN(v)) calcInstance.append(v);
    };

    window.calcTime = function(btn) {
        const v = btn.textContent;
        const nowTimeBtn = document.querySelector('#button_type2 .now_time');

        // 「＋現在時間」の結果が表示されている場合、次の入力が来たら一旦クリアする
        if (timeCalcInstance.isDateTimeDisplayed) {
            timeCalcInstance.clear();
        }

        if (v === 'AC') timeCalcInstance.clear();
        else if (v === '←') timeCalcInstance.del();
        else if (v === '＋現在時間') {
            const now = new Date();
            // 上部でクリア処理が入った場合、displayは'0'になっているので addedSec は 0 になる
            const addedSec = timeCalcInstance.parseTime(timeCalcInstance.display.textContent);
            
            now.setTime(now.getTime() + addedSec * 1000);
            
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            const d = now.getDate();
            const h = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            
            timeCalcInstance.display.textContent = `${y}年${m}月${d}日 ${h}時${min}分${s}秒`;
            timeCalcInstance.display.scrollLeft = 0;
            timeCalcInstance.isDateTimeDisplayed = true;
        }
        else if (v === '＝') {
            if (!/[+\-*/.]/.test(timeCalcInstance.display.textContent.slice(-1))) {
                timeCalcInstance.calculate();
                if (!timeCalcInstance.error) {
                    nowTimeBtn.classList.remove('disabled');
                }
            }
        }
        else if (['＋','－','×','÷'].includes(v)) timeCalcInstance.append(timeCalcInstance.operatorMap[v], true);
        else if (v === '.') { 
            const lastToken = timeCalcInstance.display.textContent.split(/[+\-*/日時分秒]/).pop();
            if (!lastToken.includes('.')) timeCalcInstance.append('.'); 
        }
        else if (['秒','分','時','日'].includes(v)) {
             const lastChar = timeCalcInstance.display.textContent.slice(-1);
             if (/\d/.test(lastChar)) {
                 timeCalcInstance.append(v); 
             } else if (['秒','分','時','日'].includes(lastChar)) {
                 timeCalcInstance.display.textContent = timeCalcInstance.display.textContent.slice(0, -1) + v;
             }
        }
        else if (!isNaN(v)) timeCalcInstance.append(v);

        // 「＝」以外のボタンが押されたら「＋現在時間」を無効化する
        if (v !== '＝') {
            nowTimeBtn.classList.add('disabled');
        }

        updateTimeOperatorsState();
    };
});