(() => {
  'use strict';

  const config = window.N2FLIX_CLOUD_CONFIG || {};
  const projectUrl = (() => {
    try {
      const parsed = new URL(String(config.url || '').trim());
      return parsed.protocol === 'https:' ? parsed.origin : '';
    } catch {
      return '';
    }
  })();
  const publishableKey = String(config.publishableKey || '').trim();
  const bucket = String(config.storageBucket || 'n2flix-catalog').replace(/[^a-z0-9_-]/gi, '');
  const configured = Boolean(projectUrl && publishableKey && bucket);
  const sessionKey = 'n2flix-cloud-session-v1';

  function readSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      return session && session.access_token ? session : null;
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    const next = { ...session, expires_at: Date.now() + Number(session.expires_in || 3600) * 1000 };
    sessionStorage.setItem(sessionKey, JSON.stringify(next));
    return next;
  }

  function authHeaders(token) {
    const headers = { apikey: publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function responseJson(response, fallback) {
    const body = await response.text();
    let value = null;
    try { value = body ? JSON.parse(body) : null; } catch { /* handled below */ }
    if (!response.ok) {
      const message = value?.msg || value?.message || value?.error_description || value?.error || fallback;
      throw new Error(String(message || fallback).slice(0, 300));
    }
    return value;
  }

  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    const response = await fetch(`${projectUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      cache: 'no-store'
    });
    const next = await responseJson(response, 'انتهت جلسة الإدارة. سجّل الدخول مجددًا.');
    return writeSession(next);
  }

  async function getSession() {
    if (!configured) return null;
    let session = readSession();
    if (!session) return null;
    if (Number(session.expires_at || 0) < Date.now() + 60000) {
      try { session = await refreshSession(session); }
      catch { sessionStorage.removeItem(sessionKey); return null; }
    }
    if (session?.user?.app_metadata?.role !== 'store_admin') return null;
    return session;
  }

  async function signIn(email, password) {
    if (!configured) throw new Error('لم يكتمل ربط قاعدة المتجر السحابية.');
    const response = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') }),
      cache: 'no-store'
    });
    const session = await responseJson(response, 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.');
    if (!session?.access_token) throw new Error('لم يُرجع تسجيل الدخول جلسة صالحة.');
    if (session.user?.app_metadata?.role !== 'store_admin') {
      await signOut();
      throw new Error('هذا الحساب لا يملك صلاحية إدارة N2flix.');
    }
    return writeSession(session);
  }

  async function signOut() {
    const session = readSession();
    try {
      if (configured && session?.access_token) {
        await fetch(`${projectUrl}/auth/v1/logout`, {
          method: 'POST', headers: authHeaders(session.access_token), cache: 'no-store'
        });
      }
    } finally {
      try { sessionStorage.removeItem(sessionKey); } catch { /* private mode */ }
    }
  }

  async function loadCatalog() {
    if (!configured) return null;
    const response = await fetch(`${projectUrl}/rest/v1/storefront_catalog?id=eq.1&select=payload`, {
      headers: authHeaders(), cache: 'no-store'
    });
    const rows = await responseJson(response, 'تعذر الاتصال بقاعدة المتجر.');
    if (!Array.isArray(rows) || !rows.length) return null;
    if (!rows[0]?.payload || !Array.isArray(rows[0].payload.products)) {
      throw new Error('بيانات الكتالوج السحابي غير صالحة.');
    }
    return rows[0].payload;
  }

  function publicObjectUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${projectUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encoded}`;
  }

  async function uploadImage(path, session) {
    let blob = await window.N2.get(path);
    if (!blob) {
      const source = new URL(path, location.href);
      const response = await fetch(source.href, { cache: 'no-store' });
      if (!response.ok) throw new Error(`تعذر قراءة صورة ${path}. أعد إضافتها من لوحة الإدارة.`);
      blob = await response.blob();
    }
    const fileName = path.split('/').pop();
    const response = await fetch(`${projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: {
        ...authHeaders(session.access_token),
        'Content-Type': blob.type || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: blob,
      cache: 'no-store'
    });
    await responseJson(response, `تعذر رفع الصورة ${fileName}.`);
    return publicObjectUrl(fileName);
  }

  async function publishCatalog(input) {
    if (!configured) throw new Error('الحفظ الفوري غير مفعّل. أكمل ربط Supabase مرة واحدة.');
    const session = await getSession();
    if (!session) throw new Error('انتهت جلسة الإدارة. سجّل الدخول مجددًا ثم أعد الحفظ.');

    const catalog = structuredClone(input);
    const media = new Map();
    for (const product of catalog.products) {
      for (const key of [product.image, ...(product.images || [])]) {
        if (typeof key === 'string' && key.startsWith('assets/uploads/')) {
          if (!media.has(key)) media.set(key, await uploadImage(key, session));
        }
      }
    }
    for (const product of catalog.products) {
      if (media.has(product.image)) product.image = media.get(product.image);
      product.images = (product.images || []).map(image => media.get(image) || image);
    }

    const response = await fetch(`${projectUrl}/rest/v1/storefront_catalog?on_conflict=id`, {
      method: 'POST',
      headers: {
        ...authHeaders(session.access_token),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ id: 1, payload: catalog, updated_at: new Date().toISOString() }),
      cache: 'no-store'
    });
    await responseJson(response, 'تعذر حفظ التغييرات. تحقق من إعدادات Supabase وصلاحية الإدارة.');
    return catalog;
  }

  window.N2Cloud = Object.freeze({
    configured: () => configured,
    session: getSession,
    signIn,
    signOut,
    loadCatalog,
    publishCatalog
  });
})();
