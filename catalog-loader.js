(() => {
  'use strict';
  window.N2CatalogReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'catalog.js?t=' + Date.now();
    script.onload = async () => {
      try {
        const local = window.N2FLIX_CATALOG;
        if (!local || !Array.isArray(local.products)) {
          throw new Error('تم تحميل catalog.js لكنه لا يحتوي قائمة منتجات صالحة.');
        }
        const remote = await window.N2Cloud?.loadCatalog();
        if (remote) window.N2FLIX_CATALOG = remote;
        resolve(window.N2FLIX_CATALOG);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('تعذر تحميل catalog.js من مجلد الموقع.'));
    document.head.append(script);
  });
})();
