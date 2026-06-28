(function () {
    let newUserId = '';
    const colorConfig = ['da7edd','c48cdc','ad9bda','93acd8','7fb9d6','66cad3','78bed4','88b4d5','9aa8d6','b199d8','c48dda']
    const msgbox = document.querySelector('div.msgholderBox');
    const msgOB = new MutationObserver(mutations => {
        newUserId = mutations[0].addedNodes[0].getAttribute('data-id').split('_')[0]
        if (uid == newUserId) inputcolorhex = nowColor()
    })
    msgOB.observe(msgbox, { childList: true })
    const nowColor = colorGroup(colorConfig)
    function colorGroup (arr) {
        let index = 0;
        function colorOut () {
            const color = arr[index];
            index = (index + 1) % arr.length;
            return color;
        }
        return colorOut;
    }
})();