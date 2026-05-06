const AppConfig = {
    menus: ['search', 'info', 'favorite', 'calc', 'shift', 'nengetsu', 'stop', 'article', 'no_register'],
    api: {
        search: '/search/',
        product: (slug) => `/db/${slug}`,
        memo: (slug) => `/memo/${slug}`,
        uuid: (uuid, type) => `/uuid/${uuid}/${type}`,
        idLoad: '/id/l',
        idChange: '/id/c',
        registerMemo: '/memo/register',
        table: (name, page = 1) => `/table/${name}?page=${page}`,
        shift: (indexDay) => `/shift/${indexDay}`
    },
    gouki: {
        '51号機':30000, '52号機':10000, '53号機':30000, '54号機':10000, '55号機':3000, '56号機':4000, 
        '57号機':1000, '58号機':4000, '59号機':4000, '60号機':4000, '61号機':4000, '62号機':4000, 
        '63号機':4000, '64号機':4000, '65号機':8000, '66号機':8000, '67号機':10000, '68号機':15000, 
        '69号機':10000, '70号機':10000, '71号機':27000, '72号機':5000, '73号機':2000, '74号機':5000, 
        '75号機':5000, '乾燥機':0
    },
    defectArticles1: [
        "異物", "異物（段替起因）", "異物（計画起因）", "異物（金型起因）", "異物（原料起因）", "@@",
        "色相（色相の濃淡）", "色相（1部分に異色の筋）", "色相（段替起因）", "色相（計画起因）", "色相（金型起因）", "@@",
        "汚れ", "汚れ（段替起因）", "汚れ（金型起因）", "汚れ（設備起因）", "@@",
        "白化", "白化（段替起因）", "白化（金型起因）", "@@",
        "ショートショット", "ショートショット（段替起因）", "ショートショット（金型起因）", "@@",
        "割れ", "割れ（グロメット挿入ミス）", "@@",
        "キズ", "キズ（落下）", "キズ（仕上げミス）", "キズ（段替起因）", "キズ（金型起因）", "キズ（設備起因）", "@@",
        "重量公差外（重量過剰）", "重量公差外（重量不足）", "@@"
    ],
    defectArticles2: [
        "バリ", "バリ（段替起因）", "バリ（金型起因）", "バリ（原料起因）", "@@",
        "フラッシュ", "フラッシュ（段替起因）", "フラッシュ（金型起因）", "フラッシュ（原料起因）", "@@",
        "ボイド", "ボイド（段替起因）", "ボイド（金型起因）", "@@",
        "糸引き", "糸引き（段替起因）", "糸引き（金型起因）", "@@",
        "ウェルド", "コールドスラグ", "ジェッティング", "ツイスト", "ハナタレ", "ヒケ", "ピンホール",
        "フローマーク", "ムシレ", "もや", "焼け", "水濡れ・結露", "寸法公差外", "転写", "反り", "分散",
        "偏肉", "変形", "未可塑", "離型", "@@"
    ],
    searchPhrases: [
        '<b class="pick_up">←|</b>','<b>#</b>','<b>1</b>','<b>2</b>','<b>3</b>','<b>4</b>','<b>5</b>','<b>6</b>','<b>7</b>','<b>8</b>','<b>9</b>','<b>0</b>',
        '型','K','C','サンケース','本体','サンペール','フタ','サンコータル','中蓋','ハンディ','エコン','パーツボックス','MK','カード差し','オリコン','長側','短側','底',
        'ハンドル','バックル','バルブ','エンジン','トレー','カバー'
    ]
};

const AppState = {
    isFirstLoad: true,
    hasProductInfo: false
};

const Utils = {
    formatNumber: (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    getCookie: (name) => {
        const value = document.cookie.split('; ').find(row => row.startsWith(name + '='));
        return value ? value.split('=')[1] : null;
    },
    addTouchClickListener: ($element, selector, callback, preventDefault = false) => {
        $element.off('click touchstart touchend', selector)
            .on('touchstart', selector, function() { $(this).data('touchMoved', false); })
            .on('touchmove', selector, function() { $(this).data('touchMoved', true); })
            .on('touchend click', selector, function(event) {
                if (event.type === 'touchend' && $(this).data('touchMoved')) return;
                if (preventDefault) event.preventDefault();
                callback.call(this, event);
            });
    }
};

const Easing = {
    custom: (t) => 1 - Math.pow(1 - t, 2)
};

$.fn.animateScroll = function(distance, duration, easing, callback) {
    easing = typeof easing === 'function' ? easing : (t) => t;
    return this.each(function() {
        const element = this;
        $(element).css({ 'scroll-snap-type': 'none', 'scroll-behavior': 'auto' });
        
        setTimeout(() => {
            $('#items').css({ 'scroll-snap-type': 'x mandatory', 'scroll-behavior': 'smooth' });
        }, duration + 10);

        if (duration === 0) {
            $(element).scrollLeft(distance);
            if (typeof callback === 'function') callback.call(element);
            return;
        }

        const startTime = performance.now();
        const startLeft = element.scrollLeft;
        const change = distance - startLeft;

        function animate(currentTime) {
            const progress = Math.min((currentTime - startTime) / duration, 1);
            element.scrollLeft = startLeft + change * easing(progress);
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else if (typeof callback === 'function') {
                callback.call(element);
            }
        }
        requestAnimationFrame(animate);
    });
};

const UrlManager = {
    getParam: (key, defaultValue = null) => {
        const params = new URLSearchParams(window.location.search);
        return params.get(key) || defaultValue;
    },
    updateParam: (key, value) => {
        const urlParams = new URLSearchParams(window.location.search);
        if (value === null) urlParams.delete(key);
        else urlParams.set(key, value);
        
        const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
        if (newUrl !== window.location.pathname + window.location.search) {
            window.history.pushState({}, '', newUrl);
        }
    },
    setMenuIndex: (index) => {
        let menu = AppConfig.menus[index];
        UrlManager.updateParam('m', (menu === 'search' || !menu) ? null : menu);
    },
    initPopState: () => {
        window.addEventListener('popstate', () => {
            const menuParam = UrlManager.getParam('m');
            let index = AppConfig.menus.indexOf(menuParam);
            MenuController.scrollToIndex(index === -1 ? 0 : index);
        });
    }
};

const MenuController = {
    init: function() {
        let isScroll = false;
        let currentPosition = 0;
        let runPosition = 0;

        if (AppState.isFirstLoad) {
            const pin = UrlManager.getParam('m', 'search');
            const pinIndex = Math.max(0, AppConfig.menus.indexOf(pin));
            this.switchingHub(pinIndex);
            this.scrollToIndex(pinIndex);
        }
        
        $('.radio_menu').on('change', (e) => {
            const selectedIndex = $('.radio_menu').index(e.currentTarget);
            runPosition = selectedIndex;
            if (!isScroll) {
                this.scrollToIndex(selectedIndex);
                this.switchingHub(selectedIndex);
            }
        });
        
        $('#items').on('scroll', function () {
            isScroll = true;
            const mathItem = this.scrollLeft / this.clientWidth;
            const threshold = 0.05;
            const direction = this.scrollLeft < currentPosition 
                ? Math.floor(mathItem + threshold) : Math.ceil(mathItem - threshold);
            
            currentPosition = this.scrollLeft;
            $('#items').css({'overflow-x': ''});
            $('#shiftFrame').css({'box-shadow': ''});
            
            if (isScroll) {
                if (runPosition !== direction) {
                    MenuController.switchingHub(direction);
                    runPosition = direction;
                    $('.radio_menu').prop('checked', false).eq(direction).prop('checked', true).trigger('change');
                }
                isScroll = false;
            }

            clearTimeout(this.scrollTimer);
            this.scrollTimer = setTimeout(() => {
                if (mathItem === 4) {
                    $('#items').css({'overflow-x': 'hidden'});
                    $('#shiftFrame').css({'box-shadow': '0px 0px 20px rgba(255, 0, 0, 1)'});
                }
            }, 50);
        });

        Utils.addTouchClickListener($('.content-box'), '', () => {
            $('#items').css({'overflow-x': ''});
            $('#shiftFrame').css({'box-shadow': ''});
        });

        $(".glink").on("click", function() {
            $("#burger_btn").prop("checked", false);
            const actionMap = { 'nengetsu': 5, 'stop': 6, 'article': 7, 'no_register': 8 };
            const id = $(this).attr("id");
            if (actionMap[id] !== undefined) MenuController.scrollToIndex(actionMap[id]);
        });
    },

    scrollToIndex: function(index) {
        let delay = AppState.isFirstLoad ? 0 : 350;
        const $items = $('#items');
        $items.animateScroll($items[0].offsetWidth * index, delay, Easing.custom, null);
    },

    switchingHub: function(index) {
        if (!AppState.isFirstLoad) UrlManager.setMenuIndex(index);

        const actions = [
            { title: "(●ω●){ 製品検索 )", act: () => SearchController.initView() },
            { title: UrlManager.getParam('sk') ? `(●ω●){ ${UrlManager.getParam('sk')}番の製品情報 )` : "(●ω●){ 製品情報 )", act: () => ProductController.initView() },
            { title: "(●ω●){ 履歴・お気に入り )", act: () => UserDataController.initFavoriteView() },
            { title: "(●ω●){ 電卓 )", act: () => {} },
            { title: "(●ω●){ シフト )", act: () => {} },
            { title: "(●ω●){ 年月マーク )", act: () => {} },
            { title: "(●ω●){ 停台コード )", act: () => ToolsController.fetchStopcode(1) },
            { title: "(●ω●){ 不良現象項目 )", act: () => ToolsController.initArticleView() },
            { title: "(●ω●){ 人工 未登録製品 )", act: () => ToolsController.initNoRegisterView() },
            { title: "(●ω●){ レコード )", act: () => {} },
        ];

        if (actions[index]) {
            document.title = actions[index].title;
            actions[index].act();
        }
    }
};

const SearchController = {
    debounceTimer: null,
    
    init: function() {
        this.$input = $('#on_search');
        this.$suggest = $('#suggest');
        this.bindEvents();
    },

    initView: async function() {
        this.$input.focus();
        $('#phrase').html(AppConfig.searchPhrases.map(p => `<span>${p}</span>`).join(''));
        
        let memo = await UserDataController.fetchMemo('HOME');
        $('#memo_HOME').text(memo);
        UserDataController.bindMemoSave('#memo_HOME', 'HOME');
    },

bindEvents: function() {
        Utils.addTouchClickListener($('#clean'), '', () => {
            MenuController.scrollToIndex(0);
            this.$input.val('');
            this.$suggest.html('');
        });

        $('#search_form').on('submit', (e) => {
            e.preventDefault();
            MenuController.scrollToIndex(0);
            let text = this.$input.val();
            if (text) this.fetchList(text);
            else this.$input.focus();
        });

        this.$input.on('input', () => {
            MenuController.scrollToIndex(0);
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.fetchList(this.$input.val()), 150);
        });

        Utils.addTouchClickListener($('#phrase'), 'span', (e) => {
            let text = $(e.currentTarget).text();
            let arr = this.$input.val().trim().split(/\s+/);
            let last = arr[arr.length - 1];
            
            if (/^\d$/.test(text) || text === '#') {
                if (/\d$/.test(last) || last.endsWith('#')) arr[arr.length - 1] += text;
                else arr.push(text);
            } else if (text === '←|') {
                arr[arr.length - 1] = arr[arr.length - 1].slice(0, -1);
            } else if (text === '型') {
                if (!last.endsWith('型')) arr[arr.length - 1] += text;
                else arr[arr.length - 1] = arr[arr.length - 1].slice(0, -1);
            } else {
                if (arr.includes(text)) arr = arr.filter(item => item !== text);
                else arr.push(text);
            }
            
            this.$input.val(arr.join(' ') + ' ').blur();
            this.fetchList(this.$input.val());
        }, true);

        Utils.addTouchClickListener($('#suggest, #favorite_list, #history_list, #no_register_list'), 'li', (e) => {
            let $li = $(e.currentTarget);
            let slug = $li.data('slug');
            if (slug) {
                ProductController.fetchData(slug);
                UrlManager.updateParam('sk', slug);
                $li.siblings().removeClass("active");
                $li.addClass("active");
                MenuController.scrollToIndex(1);
                $("#info_content").animate({ scrollTop: 0 }, 150, "swing");
                this.$input.blur();
            }
        });

        $('#suggest').on("mouseenter", "li", function() {
            if ($(this).index() !== 0) {
                $(this).siblings().removeClass("passive");
                $(this).addClass("passive");
            }
        });
    },

    fetchList: function(input) {
        input = input.trim();
        if (!input) {
            this.$suggest.html('');
            return;
        }

        $.get(AppConfig.api.search, { q: input })
            .done((data) => {
                let html = "";
                if (data.count > 0) {
                    html += `<li>検索結果 <span>${data.count}件</span></li>`;
                    data.products.reverse().forEach(p => html += `<li data-slug="${p.slug}">[${p.sk}] ${p.name}</li>`);
                } else {
                    html = `<li>検索結果</li><li>見つかりません</li>`;
                }
                this.$suggest.html(html);
            })
            .fail(err => console.error(err));
    }
};

const ProductController = {
    initView: function() {
        let sk = UrlManager.getParam('sk');
        if (sk && !AppState.hasProductInfo) this.fetchData(sk);
    },

fetchData: function(slug) {
        $.get(AppConfig.api.product(slug))
            .done(async (data) => {
                let product = data.product;
                let memo = await UserDataController.fetchMemo(slug);
                let infoHtml = "";
                let product_name = product.name;
                product.items.forEach((item, index) => {
                    let gw = item.grossWeight.replace('ｇ', '');
                    if (item.sk) infoHtml += `■■${item.sk}■■<br>`;
                    if (item.code) infoHtml += `${item.code}<br>`;
                    if (item.name) infoHtml += `${item.name}<br>`;
                    const etcHtml = item.etc ? `【備考】${item.etc.trim().replace(/\n/g, '<br>')}<br>` : '';
                    infoHtml += `
                        【仕上時間】${item.time_val || ''}<br>
                        【仕上単位】${item.unit || ''}<br>
                        【人工】${item.skill || ''}<br>
                        【異常作業】${item.abnormal || ''}<br>
                        【総重量】${item.grossWeight || ''}<span class="span_data" data-weight="${gw || ''}" data-quantity="${item.spawn || ''}">原料調整</span><br>
                        【重量公差】${item.wgt || ''}<br>
                        【取数】${item.spawn || ''}<br>
                        【実ｻｲｸﾙ】${item.cycle_val || ''}<br>
                        【標準ｻｲｸﾙ】${item.standard || ''}<br>
                        【材質】${item.material || ''}<br>
                        【原料】${item.raw || ''}<br>
                        【MFR】${item.raw_mfr || ''}<br>
                        【梱包】${item.one_box || ''}<br>
                        【積載】${item.pallet || ''}<br>
                        【テープ】${item.tape || ''}<br>
                        【ﾀﾞﾝﾎﾞｰﾙ】${item.box || ''}<br>
                        【袋】${item.bag || ''}<br>
                        ${etcHtml}
                        ______________________<br>`;
                });
                
                $('.temp_elem').hide();
                let len = product.count;
                let pre =  len > 1 ? `${len}種類あるようだ` : `約束のものはこれだ`;
                $('#product').html(`
                    <div class="gr_balloon r_b"><span class="pick_up">${product.slug}番</span>の製品情報が欲しい</div>
                    <div class="wh_balloon js l_b">${pre}</div>
                    <div class="wh_balloon js l_b" id="product_data">${infoHtml}<div class="heart" data-slug="${product.slug}$$${product_name}"></div></div>
                    <div id="adjustment"></div><div id="adjustment_answer"></div>
                    <div class="gr_balloon r_b">
                        <form id="form_memo" method="POST">
                            <div><label for="memo">メモ (共有)</label>
                            <textarea name="memo" id="memo" spellcheck="false">${memo}</textarea></div>
                        </form>
                    </div>
                `);

                UserDataController.bindHeartEvent();
                await UserDataController.saveFavorite('h', product.slug, product_name);
                UserDataController.bindMemoSave('#memo', slug);
                this.bindGoukiEvents();
                AppState.hasProductInfo = true;
            })
            .fail(err => console.error(err));
    },

    bindGoukiEvents: function() {
        Utils.addTouchClickListener($('#product'), '.span_data', (e) => {
            const $btn = $(e.currentTarget);
            let weight = Number($btn.data('weight'));
            let quantity = Number($btn.data('quantity'));
            let goukiHtml = Object.entries(AppConfig.gouki).map(([key, cap]) => 
                `<span class='gouki none_selection' data-capacity=${cap} data-weight=${weight} data-quantity=${quantity}>${key}</span>`
            ).join('');
            
            $('#adjustment').html(`<div class="gr_balloon r_b">原料調整をする機台は<br>${goukiHtml}</div>`).show();
            $('#adjustment_answer').css('display', '');
            
            let $container = $('#info_content');
            let targetTop = Math.min(
                $('#adjustment').offset().top - $container.offset().top + $container.scrollTop() - $container.height() / 2 + 150,
                $container.prop('scrollHeight') - $container.height()
            );
            $container.animate({ scrollTop: targetTop }, 200);
        });

        Utils.addTouchClickListener($('#product'), '.gouki', (e) => {
            const $g = $(e.currentTarget);
            $g.siblings().removeClass("active");
            $g.addClass("active");
            
            let name = $g.text();
            let weight = Number($g.data('weight'));
            let qty = Number($g.data('quantity'));
            let cap = Number($g.data('capacity'));
            let shot = Math.floor(cap / weight / 10) * 10;
            
            const interpolate = (n, x1, y1, x2, y2, max = null) => {
                let v = y1 + (y2 - y1) * ((n - x1) / (x2 - x1));
                return max !== null ? Math.min(v, max) : v;
            };
            
            let mixing = qty * Math.floor(shot * interpolate(cap, 4000, 0.29, 30000, 0.19, 0.3) / 10) * 10;
            const dryer = (c, w, q) => (Math.floor(((c / w) * q) * 0.8 / 10) * 10) || 1;
            
            let ansHtml = cap === 0 
                ? `<div class="wh_balloon js l_b">乾燥機の調整は余裕をもって計算だ。<br>
                   ${Utils.formatNumber(weight)}ｇの${qty}個取りで、<br>
                   100kg級の乾燥機は<span class="pick_up">${Utils.formatNumber(dryer(100000, weight, qty))}個</span>程度。<br>
                   75kg級の乾燥機は<span class="pick_up">${Utils.formatNumber(dryer(75000, weight, qty))}個</span>程度。<br>
                   50kg級の乾燥機は<span class="pick_up">${Utils.formatNumber(dryer(50000, weight, qty))}個</span>程度。<br>
                   10kgの手混ぜは<span class="pick_up">${Utils.formatNumber(dryer(10000, weight, qty))}個</span>程度。<br>
                   1kgの手混ぜは<span class="pick_up">${Utils.formatNumber(dryer(1000, weight, qty))}個</span>程度。</div>`
                : `<div class="wh_balloon js l_b">${name}は${cap/1000}kg級の容量だ。<br>
                   ${Utils.formatNumber(cap)}ｇ ÷ ${Utils.formatNumber(weight)}ｇ ＝ 約${Utils.formatNumber(shot)}ショット<br>
                   これは${qty}個取りだから<span class="pick_up">${Utils.formatNumber(shot * qty)}個</span>くらいできるわけだ。<br>
                   撹拌分なら<span class="pick_up">${Utils.formatNumber(mixing)}個</span>程度。<br>
                   余裕を持ったほうがいいだろう。</div>`;
                   
            $('#adjustment_answer').html(ansHtml).show();
        });
    }
};

const UserDataController = {
    initFavoriteView: function() {
        this.renderList('f');
        this.renderList('h');
        this.initIdManager();
        $("#favorite_content").animate({ scrollTop: 0 }, 150, "swing");
    },

    fetchMemo: function(slug) {
        return new Promise(resolve => {
            $.get(AppConfig.api.memo(slug)).done(d => resolve(d.memo)).fail(() => resolve(""));
        });
    },

    bindMemoSave: function(selector, slug) {
        let timer;
        $(selector).on('input', function () {
            clearTimeout(timer);
            timer = setTimeout(() => {
                $.ajax({
                    type: 'POST', url: AppConfig.api.memo(slug),
                    contentType: 'application/json', data: JSON.stringify({ memo: $(this).val() })
                });
            }, 300);
        });
    },

    fetchFavorite: function(type) {
        const uuid = Utils.getCookie('user_uuid');
        return new Promise((resolve, reject) => {
            if (!uuid) return reject('UUIDが無効です');
            $.get(AppConfig.api.uuid(uuid, type))
                .done(d => resolve(type === 'f' ? d.favorite || '' : d.history || ''))
                .fail(() => reject('リクエスト失敗'));
        });
    },

    saveFavorite: async function(type, slug, name, entry = 1) {
        const uuid = Utils.getCookie('user_uuid');
        if (!uuid) return;
        try {
            let current = await this.fetchFavorite(type);
            let arr = current.split('@@').filter(Boolean);
            const newVal = `${slug}$$${name}`;
            arr = arr.filter(item => item !== newVal);
            
            if (entry !== 0) {
                arr.push(newVal);
                arr = arr.slice(-30);
            }
            
            await $.ajax({
                type: 'POST', url: AppConfig.api.uuid(uuid, type),
                contentType: 'application/json', data: JSON.stringify({ value: arr.join('@@') })
            });
        } catch (err) { console.error(err); }
    },

    bindHeartEvent: async function() {
        let slugData = $('.heart').data('slug').split('$$');
        let current = await this.fetchFavorite('f');
        let isFav = current.split('@@').some(val => val.split('$$')[0] === String(slugData[0]));
        
        $('.heart').css('background-image', `url("static/image/heart_${isFav ? 'on' : 'off'}.png")`);

        Utils.addTouchClickListener($('#product'), '.heart', (e) => {
            let $h = $(e.currentTarget);
            let isOn = $h.css('background-image').includes('heart_on');
            this.saveFavorite('f', slugData[0], slugData[1], isOn ? 0 : 1);
            $h.css('background-image', `url("static/image/heart_${isOn ? 'off' : 'on'}.png")`);
        }, true);
    },

    renderList: async function(type) {
        try {
            let current = await this.fetchFavorite(type);
            let arr = current.split('@@').filter(Boolean);
            let html = `<li>${arr.length} / 30</li>`;
            arr.slice().reverse().forEach(val => {
                let v = val.split('$$');
                html += `<li data-slug="${v[0]}">[${v[0]}] ${v[1]}</li>`;
            });
            $(`#${type === 'f' ? 'favorite' : 'history'}_list`).html(html + '<li></li>');
        } catch (err) { $("#err").html(`エラー: ${err}`); }
    },

    initIdManager: function() {
        let t;
        $('#id_load, #id_change').hide();
        
        let currentUuid = Utils.getCookie('user_uuid');
        if (currentUuid) {
            $('#uuid').val(currentUuid);
        }

        $('#uuid').on('focus', () => {
            clearTimeout(t);
            $('#id_load, #id_change').show();
        }).on('blur', () => {
            t = setTimeout(() => $('#id_load, #id_change').fadeOut(), 3000);
        });

        const handleIdRequest = async (btnId, url) => {
            Utils.addTouchClickListener($(`#${btnId}`), '', async () => {
                try {
                    const uuid = Utils.getCookie('user_uuid');
                    const inputVal = $('#uuid').val();
                    if (!uuid) return;
                    if (uuid === inputVal) return $('#id_msg').text(btnId === 'id_load' ? '他のIDを読み込む' : 'IDを変更できます');
                    
                    const res = await $.ajax({ type: 'POST', url: url, contentType: 'application/json', data: JSON.stringify({ value: inputVal }) });
                    if (res.result) {
                        let d = new Date();
                        d.setTime(d.getTime() + (180 * 24 * 3600 * 1000));
                        document.cookie = `user_uuid=${res.msg}; path=/; expires=${d.toUTCString()}`;
                        window.location.reload();
                    } else {
                        $('#id_msg').text(res.msg);
                    }
                } catch (err) { $('#id_msg').text(err); }
                finally { setTimeout(() => $('#id_msg').text(''), 3000); }
            });
        };
        handleIdRequest('id_load', AppConfig.api.idLoad);
        handleIdRequest('id_change', AppConfig.api.idChange);
    }
};

const ToolsController = {
    fetchStopcode: function(page = 1) {
        $.get(AppConfig.api.table('stopcode', page)).done(data => {
            let html = data.stopcode.map(v => {
                let liabilityHtml = v.liability ? `<span class="annotation inline">責任 [${v.liability}]</span>` : '';
                let reasonHtml = v.reason ? `<p class="annotation">${v.reason}</p>` : '';
                let detailsHtml = v.details ? `<p class="annotation">${v.details}</p>` : '';
                
                return `<div class="wh_balloon kr l_b"><span class="pick_up">【${v.code}】${v.pattern}</span>${liabilityHtml}${reasonHtml}${detailsHtml}</div>`;
            }).join('');
            
            $('#stop_code').html(html);
        }).fail(err => console.error(err));
    },

    initArticleView: function() {
        const gline = '<div class="gline"></div>';
        const buildHtml = (articles) => {
            let html = gline;
            articles.forEach(val => {
                if (val === "@@") {
                    html += gline;
                } else {
                    html += `<p>${val}</p>`;
                }
            });
            return html;
        };

        $('#defect_article').html(buildHtml(AppConfig.defectArticles1));
        $('#defect_article2').html(buildHtml(AppConfig.defectArticles2));
    },

    initNoRegisterView: function() {
        $.get(AppConfig.api.registerMemo).done(d => {
            const dateStr = d.memo ? `${d.memo.slice(0, 4)}年${parseInt(d.memo.slice(4, 6), 10)}月${parseInt(d.memo.slice(6), 10)}日` : '不明な日付';
            
            $.get(AppConfig.api.search, { q: '未登録' }).done(data => {
                let html = "";
                let countMsg = `<li>未登録はありません</li>`;
                if (data.count > 0) {
                    data.products.reverse().forEach(p => html += `<li data-slug="${p.slug}">[${p.sk}]【${p.code || ''}】${p.name}</li>`);
                    countMsg = `${dateStr}時点で人工の未登録は ${data.count}件です。<br>班長は業務メニューから登録をしてください。`;
                }
                $('#no_register_count').html(countMsg);
                $('#no_register_list').html(html);
            });
        }).fail(err => console.error(err));
    },

    initSlider: function() {
        let $slider = $('#slider'), $thumb = $('#slider .thumb');
        let sliderWidth, thumbWidth;
        let currentValue = 0, updateTimer;
        
        const updatePos = (val) => {
            let pos = ((val + 36) / 72) * (sliderWidth - thumbWidth);
            $thumb.css('left', Math.max(0, Math.min(pos, sliderWidth - thumbWidth)));
        };
        const resize = () => { sliderWidth = $slider.width(); thumbWidth = $thumb.width(); updatePos(currentValue); };
        
        resize();
        $(window).on('resize', resize);
        new MutationObserver(resize).observe($slider[0], { attributes: true, attributeFilter: ['style'] });

        $thumb.on('mousedown touchstart', (e) => {
            e.preventDefault();
            let startX = e.pageX || e.originalEvent.touches[0].pageX;
            let startLeft = $thumb.position().left;
            if (!updateTimer) updateTimer = setInterval(updateNeedle, 30);
            
            $(document).on('mousemove touchmove', (eMove) => {
                let currentX = eMove.pageX || eMove.originalEvent.touches[0].pageX;
                let val = ((startLeft + (currentX - startX)) / (sliderWidth - thumbWidth)) * 72 - 36;
                currentValue = Math.round(Math.max(-36, Math.min(val, 36)));
                updatePos(currentValue);
            }).on('mouseup touchend', () => {
                $(document).off('mousemove touchmove mouseup touchend');
                clearInterval(updateTimer); updateTimer = null;
            });
        });

        function updateNeedle() {
            let d = new Date(), currentY = d.getFullYear(), currentM = d.getMonth();
            d.setMonth(d.getMonth() + currentValue);
            let yArr = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N"];
            let mArr = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"];
            
            let yIdx = (d.getFullYear() - 5) % yArr.length;
            if (yIdx < 0) yIdx += yArr.length;
            
            let html = `<span class="y_arr">${yArr[yIdx]}年</span><span class="m_arr">${mArr[d.getMonth()]}月</span><br>` +
                       `<span class="y_arr">${d.getFullYear()}年</span><span class="m_arr">${d.getMonth() + 1}月</span>` +
                       (currentY === d.getFullYear() && currentM === d.getMonth() ? '<span class="pick_up">（現在）</span>' : '');
            
            $('#num_slider').html(html);
            $('#year_needle').css('transform', `rotate(${(d.getFullYear() - 5) * (360 / 13)}deg)`);
            $('#month_needle').css('transform', `rotate(${d.getMonth() * 30}deg)`);
        }
        updateNeedle();
    },

    initClock: function() {
        let $target = $('#now');
        const offset = new Date().getTime() - new Date($target.text()).getTime();

        const updateClock = () => {
            const now = new Date(new Date().getTime() - offset);
            $target.text(`{ ${now.getFullYear()}年${String(now.getMonth()+1).padStart(2,'0')}月${String(now.getDate()).padStart(2,'0')}日 ${String(now.getHours()).padStart(2,'0')}時${String(now.getMinutes()).padStart(2,'0')}分${String(now.getSeconds()).padStart(2,'0')}秒 )`);
        };

        updateClock();
        setInterval(updateClock, 1000);
    },
    
};

$(document).ready(() => {
    UrlManager.initPopState();
    ToolsController.initClock();
    SearchController.init();
    MenuController.init();
    ToolsController.initSlider();
    AppState.isFirstLoad = false;
});