// 削除ボタン押下時に確認ダイアログを表示
document.querySelectorAll('form.confirm-delete').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!window.confirm('本当に削除しますか？この操作は取り消せません。')) e.preventDefault();
  });
});
