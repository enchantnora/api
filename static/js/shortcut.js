const explicit = [
    {n: '製品検索', u: 'https://www.icloud.com/shortcuts/05e42b15e2434a02a8139d7d2fbe017c',
     c: ['入力欄に [SK番号か商品コード] を入力で製品の情報を表示。',
        '商品コードにアルファベットがある場合は.(小数点)に置き換え可。',
        '空欄で完了すると、テキストボックスが表示されます。',
        'これはキーワード検索用で、[製品名や曖昧な番号] で探すことができます。',
        '※ ひらがな・ローマ字でもOK']},
    {n: 'シフト', u: 'https://www.icloud.com/shortcuts/f2cb86c651cc415e8f9800c28416f07e',
     c: ['シフトを日別で表示。',
        '左右にスワイプで日を遷移します。',
        '長押しすると[現在][+7日][-7日]ボタンが出現し、一週間単位でジャンプできます。',
        '2021年12月16日から記録。']},
    {n: '時間計算', u: 'https://www.icloud.com/shortcuts/ed150fd8c98544aebc57811a8eb351af',
     c: ['入力欄に [残りショット数] と [サイクル(秒)] を入力します。',
        '残り時間と完成予定時刻を表示。']},
    {n: '原料調整', u: 'https://www.icloud.com/shortcuts/3d649c5074874dc0b10d6d94c02a64ad',
     c: ['事前に製品検索で【総重量】を調べる。',
        '最初の入力欄に [号機(51～75)] を入力します。',
        '次に [総重量] を入力。',
        'ショット数が表示されます。余裕をもって調整しましょう。',
        '※ 撹拌調整は1/3程度になるので注意!!']},
    {n: '不良率計算', u: 'https://www.icloud.com/shortcuts/19212de4dba74dc4a0d9e617891a5de9',
     c: ['最初の入力欄に [良品数] を入力します。',
        '次に [不良品数] を入力。',
        '不良率が表示されます。']}
];

const targetElement = document.getElementById('shortcut_detail');

if (targetElement) {
    const htmlContent = explicit.map(item => {
        const spanElements = item.c.map(text => {
            return `                                        <div>${text}</div>`;
        }).join('\n');

        return `                            <div class="sho_t"><h5 class="mezzo">${item.n}</h5>
                                <div class="gline"></div>
                                <div class="d">
                                    <a class="banner" href="${item.u}" target="_blank" rel="noopener noreferrer"></a>
                                    <div class="dd">
${spanElements}
                                    </div>
                                </div>
                            </div>`;
    }).join('\n');

    targetElement.innerHTML = htmlContent;
} else {
    console.error('id="shortcut_detail" の要素が見つかりません。');
}