/* StudyGlass — calendar planner with optional secure Supabase sync.
   Public credentials live in config.js; authenticated database rows are protected by RLS.
   No user-supplied text is rendered as HTML. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const LOCAL_KEY = 'studyglass.local.items.v1';
  const LANGUAGE = 'ar-OM-u-ca-gregory-nu-latn';
  const config = window.STUDYGLASS_CONFIG || {};
  const cloudConfigReady = Boolean(
    typeof config.supabaseUrl === 'string' && /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl) &&
    typeof config.supabasePublishableKey === 'string' && config.supabasePublishableKey.startsWith('sb_publishable_')
  );
  let client = null;
  let user = null;
  let items = [];
  let viewedMonth = new Date();
  let selectedDate = dateKey(new Date());
  let filter = 'all';
  let editingId = null;
  let editingType = 'exam';
  let authMode = 'login';
  let saving = false;
  let sessionGeneration = 0;
  let syncIssue = false;
  let toastTimer;

  const dateFormat = new Intl.DateTimeFormat(LANGUAGE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthFormat = new Intl.DateTimeFormat(LANGUAGE, { month: 'long', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(LANGUAGE, { weekday: 'long' });
  const shortMonth = new Intl.DateTimeFormat(LANGUAGE, { month: 'short' });
  const today = () => dateKey(new Date());
  const clone = obj => JSON.parse(JSON.stringify(obj));

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function dateFromKey(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }
  function dom(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent !== undefined) el.textContent = String(textContent);
    return el;
  }
  function setText(selector, text) {
    $(selector).textContent = String(text);
  }
  function identity() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function cleanItem(value) {
    if (!value || !/^\d{4}-\d\d-\d\d$/.test(String(value.item_date))) return null;
    const kind = value.item_type === 'task' ? 'task' : 'exam';
    const title = String(value.title || '').trim().slice(0, 120);
    if (!title) return null;
    return {
      id: String(value.id || identity()), user_id: value.user_id || null,
      item_type: kind, title, item_date: value.item_date,
      item_time: value.item_time ? String(value.item_time).slice(0, 5) : null,
      subject: String(value.subject || '').slice(0, 70),
      notes: String(value.notes || '').slice(0, 1200),
      completed: Boolean(value.completed), created_at: value.created_at || new Date().toISOString()
    };
  }
  function readLocal() {
    try {
      const source = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(source) ? source.map(cleanItem).filter(Boolean) : [];
    } catch (_) { return []; }
  }
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items)); return true; }
    catch (_) { showToast('تعذر الحفظ على هذا الجهاز. تأكد من السماح بالتخزين.', true); return false; }
  }
  function sorted(source) {
    return [...source].sort((a, b) => a.item_date.localeCompare(b.item_date) ||
      (a.item_time || '99:99').localeCompare(b.item_time || '99:99') ||
      (a.item_type === b.item_type ? 0 : a.item_type === 'exam' ? -1 : 1));
  }
  function typeName(item) { return item.item_type === 'exam' ? 'اختبار' : 'مهمة'; }
  function dateLabel(item) {
    const parts = [];
    if (item.subject) parts.push(item.subject);
    if (item.item_time) parts.push(item.item_time);
    if (item.notes) parts.push(item.notes);
    return parts.join(' · ') || typeName(item);
  }

  function showToast(message, error = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 4100);
  }
  function setSync(status, text) {
    const el = $('#sync-pill');
    el.classList.toggle('online', status === 'online');
    el.classList.toggle('error', status === 'error');
    setText('#sync-text', text);
    el.title = text;
  }
  function updateAuthUI() {
    const hasCloud = Boolean(client);
    const signedIn = Boolean(user);
    setText('#account-label', signedIn ? (user.email || 'حسابي') : 'تسجيل الدخول');
    setText('#signed-email', user?.email || '');
    $('#auth-signed-out').classList.toggle('hidden', signedIn);
    $('#auth-signed-in').classList.toggle('hidden', !signedIn);
    const savedLocally = readLocal().length;
    $('#import-local').classList.toggle('hidden', !signedIn || savedLocally === 0);
    $('#import-local').textContent = `نقل ${savedLocally} موعد من هذا الجهاز إلى حسابك`;
    $('#auth-submit').disabled = !hasCloud;
    $('#auth-email').disabled = !hasCloud;
    $('#auth-password').disabled = !hasCloud;
    if (!hasCloud) {
      setText('#auth-notice', 'تعذّر تحميل خدمة Supabase. تحقق من الإنترنت وأعد تحميل الصفحة. يمكنك استخدام الحفظ المحلي الآن.');
    }
    setText('#privacy-text', signedIn
      ? (syncIssue ? 'الاتصال بالسحابة غير متاح حاليًا. لم تتأكد مزامنة آخر التغييرات؛ حاول مجددًا عند عودة الاتصال.' : 'متصل بحسابك. تتم مزامنة مواعيدك مع Supabase، ولا تظهر للآخرين.')
      : 'سجّل الدخول لتظهر مواعيدك من أي تلفون. بدون حساب، الحفظ على هذا الجهاز فقط.');
    if (!signedIn) setSync('local', 'حفظ محلي');
    else if (syncIssue) setSync('error', 'تعذّر الاتصال');
    else setSync('online', 'متصل بالسحابة');
  }

  function render() {
    setText('#month-title', monthFormat.format(viewedMonth));
    setText('#hero-date', dateFormat.format(new Date()));
    setText('#hero-day-number', new Date().getDate());
    setText('#hero-month-label', new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date()).toUpperCase());
    setText('#year', new Date().getFullYear());

    const monthPrefix = dateKey(new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1)).slice(0, 7);
    setText('#stat-month', items.filter(item => item.item_date.startsWith(monthPrefix)).length);
    setText('#stat-exams', items.filter(item => item.item_type === 'exam' && !item.completed && item.item_date >= today()).length);
    setText('#stat-tasks', items.filter(item => item.item_type === 'task' && !item.completed).length);
    setText('#stat-done', items.filter(item => item.completed).length);

    renderCalendar();
    renderDayDetails();
    renderUpcoming();
  }
  function matches(item) { return filter === 'all' || item.item_type === filter; }
  function renderCalendar() {
    const grid = $('#calendar-grid');
    grid.replaceChildren();
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    const weekdayStart = new Date(year, month, 1, 12).getDay();
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    const cells = Math.ceil((weekdayStart + daysInMonth) / 7) * 7;
    const visibleByDate = new Map();
    for (const item of sorted(items.filter(matches))) {
      if (!visibleByDate.has(item.item_date)) visibleByDate.set(item.item_date, []);
      visibleByDate.get(item.item_date).push(item);
    }
    for (let index = 0; index < cells; index++) {
      const d = new Date(year, month, index - weekdayStart + 1, 12);
      const key = dateKey(d);
      const dayItems = visibleByDate.get(key) || [];
      const out = d.getMonth() !== month;
      const cell = dom('button', 'calendar-day');
      cell.type = 'button';
      if (out) cell.classList.add('outside');
      if (key === selectedDate) cell.classList.add('selected');
      if (key === today()) cell.classList.add('is-today');
      cell.setAttribute('aria-label', `${dateFormat.format(d)} — ${dayItems.length ? dayItems.length + ' مواعيد' : 'بدون مواعيد'}`);
      cell.setAttribute('aria-pressed', String(key === selectedDate));
      cell.addEventListener('click', () => {
        selectedDate = key;
        if (out) viewedMonth = new Date(d.getFullYear(), d.getMonth(), 1, 12);
        render();
        if (window.matchMedia('(max-width: 890px)').matches) $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const top = dom('span', 'day-top');
      top.append(dom('span', 'day-index', d.getDate()));
      if (dayItems.length) top.append(dom('span', 'date-count', dayItems.length));
      cell.append(top);
      const events = dom('span', 'day-events');
      dayItems.slice(0, 2).forEach(item => {
        const badge = dom('span', `mini-event ${item.item_type}${item.completed ? ' completed' : ''}`);
        badge.append(dom('i', 'event-dot'));
        badge.append(dom('span', 'event-name', item.title));
        badge.append(dom('span', 'mobile-name', typeName(item)));
        badge.title = item.title;
        events.append(badge);
      });
      if (dayItems.length > 2) events.append(dom('span', 'more-event', `+${dayItems.length - 2} إضافية`));
      cell.append(events);
      grid.append(cell);
    }
  }
  function renderDayDetails() {
    const d = dateFromKey(selectedDate);
    setText('#selected-number', d.getDate());
    setText('#selected-day-name', dayFormat.format(d));
    setText('#selected-long-date', dateFormat.format(d));
    const list = $('#selected-list');
    list.replaceChildren();
    const dayItems = sorted(items.filter(item => item.item_date === selectedDate && matches(item)));
    if (!dayItems.length) {
      const empty = dom('div', 'empty-state');
      empty.append(dom('span', 'empty-icon', '▤'));
      empty.append(dom('strong', 'ما عندك مواعيد في هذا اليوم'));
      empty.append(dom('small', 'أضف اختبار أو مهمة وبتظهر هنا وداخل التقويم.'));
      const add = dom('button', '', '＋ أضف موعد لهذا اليوم');
      add.type = 'button'; add.addEventListener('click', () => openItem(null, selectedDate));
      empty.append(add); list.append(empty); return;
    }
    for (const item of dayItems) {
      const card = dom('div', 'event-card');
      const glyph = dom('div', `event-kind ${item.item_type}`, item.item_type === 'exam' ? '◇' : '☰');
      const details = dom('div', 'event-detail' + (item.completed ? ' done' : ''));
      details.append(dom('strong', '', item.title));
      details.append(dom('small', '', dateLabel(item)));
      const actions = dom('div', 'event-actions');
      const check = dom('button', 'check-btn' + (item.completed ? ' checked' : ''), '✓');
      check.type = 'button'; check.title = item.completed ? 'إلغاء الإنجاز' : 'تحديد كمنجز';
      check.setAttribute('aria-label', check.title + ': ' + item.title);
      check.addEventListener('click', () => toggleCompleted(item));
      const edit = dom('button', 'edit-btn', '✎');
      edit.type = 'button'; edit.title = 'تعديل ' + item.title;
      edit.setAttribute('aria-label', edit.title);
      edit.addEventListener('click', () => openItem(item));
      actions.append(check, edit); card.append(glyph, details, actions); list.append(card);
    }
  }
  function renderUpcoming() {
    const list = $('#upcoming-list');
    list.replaceChildren();
    const upcoming = sorted(items.filter(item => matches(item) && !item.completed && item.item_date >= today())).slice(0, 6);
    setText('#upcoming-count', upcoming.length);
    if (!upcoming.length) {
      const empty = dom('div', 'empty-state');
      empty.style.minHeight = '115px';
      empty.append(dom('span', 'empty-icon', '✓'));
      empty.append(dom('strong', 'ما عندك مواعيد قادمة'));
      empty.append(dom('small', 'استمتع بوقتك أو أضف موعدًا جديدًا.'));
      list.append(empty); return;
    }
    for (const item of upcoming) {
      const button = dom('button', 'upcoming-entry');
      button.type = 'button'; button.title = item.title;
      button.addEventListener('click', () => {
        selectedDate = item.item_date;
        const d = dateFromKey(selectedDate);
        viewedMonth = new Date(d.getFullYear(), d.getMonth(), 1, 12);
        filter = 'all'; syncFilters(); render();
        $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      const d = dateFromKey(item.item_date);
      const stamp = dom('span', 'upcoming-date');
      stamp.append(dom('strong', '', d.getDate()), dom('span', '', shortMonth.format(d)));
      const caption = dom('span', 'upcoming-text');
      caption.append(dom('strong', '', item.title), dom('small', '', dateLabel(item)));
      button.append(stamp, caption, dom('span', 'upcoming-type', typeName(item)));
      list.append(button);
    }
  }
  function syncFilters() {
    $$('.filter').forEach(button => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function pickType(type) {
    editingType = type === 'task' ? 'task' : 'exam';
    $$('.type-option').forEach(button => {
      const active = button.dataset.type === editingType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function openModal(name) {
    $('#' + name + '-layer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(name) {
    $('#' + name + '-layer').classList.add('hidden');
    if ($$('.dialog-layer:not(.hidden)').length === 0) document.body.style.overflow = '';
  }
  function openItem(item = null, date = selectedDate) {
    editingId = item?.id || null;
    pickType(item?.item_type || 'exam');
    $('#item-form').reset();
    $('#field-title').value = item?.title || '';
    $('#field-date').value = item?.item_date || date;
    $('#field-time').value = item?.item_time || '';
    $('#field-subject').value = item?.subject || '';
    $('#field-notes').value = item?.notes || '';
    $('#field-completed').checked = Boolean(item?.completed);
    $('#delete-item').classList.toggle('hidden', !item);
    setText('#item-title', item ? 'تعديل الموعد' : 'إضافة موعد جديد');
    setText('#save-item', item ? 'حفظ التعديلات' : 'حفظ الموعد');
    openModal('item');
    setTimeout(() => $('#field-title').focus({ preventScroll: true }), 30);
  }
  function setSaving(flag) {
    saving = flag;
    $('#save-item').disabled = flag;
    $('#delete-item').disabled = flag;
    $$('.type-option').forEach(b => { b.disabled = flag; });
  }
  function currentInput() {
    return {
      item_type: editingType,
      title: $('#field-title').value.trim(),
      item_date: $('#field-date').value,
      item_time: $('#field-time').value || null,
      subject: $('#field-subject').value.trim(),
      notes: $('#field-notes').value.trim(),
      completed: $('#field-completed').checked
    };
  }
  function errorString(error) {
    const raw = String(error?.message || 'خطأ غير معروف');
    if (/relation .* does not exist|could not find the table|schema cache/i.test(raw)) return 'جدول planner_items غير موجود. شغّل ملف schema.sql في Supabase أولًا.';
    if (/failed to fetch|network|fetch failed|networkerror/i.test(raw)) return 'تعذّر الاتصال بالسحابة. تحقق من الإنترنت وحاول مرة أخرى.';
    if (/row.level.security|permission denied/i.test(raw)) return 'رفضت قاعدة البيانات العملية. تأكد من تشغيل schema.sql وتسجيل الدخول.';
    return raw.slice(0, 170);
  }
  async function persistItem(payload) {
    if (!user) {
      if (editingId) {
        const at = items.findIndex(x => x.id === editingId);
        if (at < 0) throw new Error('لم يتم العثور على الموعد.');
        const before = clone(items);
        items[at] = cleanItem({ ...items[at], ...payload });
        if (!saveLocal()) { items = before; throw new Error('تعذر حفظ الموعد على الجهاز.'); }
      } else {
        const before = clone(items);
        items.push(cleanItem({ ...payload, id: identity(), created_at: new Date().toISOString() }));
        if (!saveLocal()) { items = before; throw new Error('تعذر حفظ الموعد على الجهاز.'); }
      }
      return;
    }
    const data = { ...payload, user_id: user.id };
    let result;
    if (editingId) result = await client.from('planner_items').update(data).eq('id', editingId).eq('user_id', user.id).select('*').single();
    else result = await client.from('planner_items').insert(data).select('*').single();
    if (result.error) { syncIssue = true; updateAuthUI(); throw result.error; }
    const item = cleanItem(result.data);
    if (editingId) items = items.map(existing => existing.id === item.id ? item : existing);
    else items.push(item);
    syncIssue = false; updateAuthUI();
  }
  async function submitItem(event) {
    event.preventDefault();
    if (saving) return;
    const values = currentInput();
    if (!values.title || !/^\d{4}-\d\d-\d\d$/.test(values.item_date)) return showToast('اكتب اسم الموعد والتاريخ أولًا.', true);
    setSaving(true);
    try {
      await persistItem(values);
      const newDate = dateFromKey(values.item_date);
      selectedDate = values.item_date;
      viewedMonth = new Date(newDate.getFullYear(), newDate.getMonth(), 1, 12);
      closeModal('item'); render();
      showToast(editingId ? 'تم حفظ التعديل ✓' : 'تمت إضافة الموعد ✓');
    } catch (err) { showToast(errorString(err), true); }
    finally { setSaving(false); }
  }
  async function deleteItem() {
    if (!editingId || saving) return;
    if (!window.confirm('تأكيد حذف هذا الموعد؟')) return;
    setSaving(true);
    try {
      if (user) {
        const { error } = await client.from('planner_items').delete().eq('id', editingId).eq('user_id', user.id);
        if (error) { syncIssue = true; updateAuthUI(); throw error; }
        syncIssue = false; updateAuthUI();
        items = items.filter(x => x.id !== editingId);
      } else {
        const before = clone(items);
        items = items.filter(x => x.id !== editingId);
        if (!saveLocal()) { items = before; throw new Error('تعذر حفظ الحذف على الجهاز.'); }
      }
      closeModal('item'); render(); showToast('تم حذف الموعد');
    } catch (err) { showToast(errorString(err), true); }
    finally { setSaving(false); }
  }
  async function toggleCompleted(item) {
    const next = !item.completed;
    if (user) {
      const { data, error } = await client.from('planner_items').update({ completed: next }).eq('id', item.id).eq('user_id', user.id).select('*').single();
      if (error) { syncIssue = true; updateAuthUI(); showToast(errorString(error), true); return; }
      const normalized = cleanItem(data);
      items = items.map(x => x.id === item.id ? normalized : x);
      syncIssue = false; updateAuthUI();
    } else {
      const before = clone(items);
      items = items.map(x => x.id === item.id ? { ...x, completed: next } : x);
      if (!saveLocal()) { items = before; return; }
    }
    render(); showToast(next ? 'أحسنت! تم الإنجاز ✓' : 'تم إلغاء الإنجاز');
  }

  async function fetchCloudRows(forUser, generation) {
    const all = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const { data, error } = await client.from('planner_items')
        .select('*').eq('user_id', forUser.id)
        .order('item_date', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (generation !== sessionGeneration) return;
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    if (generation !== sessionGeneration) return;
    items = all.map(cleanItem).filter(Boolean);
    syncIssue = false;
    updateAuthUI(); render();
  }
  async function applySession(session) {
    const generation = ++sessionGeneration;
    const nextUser = session?.user || null;
    const changed = nextUser?.id !== user?.id;
    user = nextUser;
    if (!user) {
      items = readLocal();
      syncIssue = false; updateAuthUI(); render();
      return;
    }
    if (changed) {
      items = [];
      syncIssue = false;
      updateAuthUI(); render();
    }
    setSync('local', 'جارِ المزامنة…');
    try { await fetchCloudRows(user, generation); }
    catch (error) {
      if (generation !== sessionGeneration) return;
      syncIssue = true; updateAuthUI();
      showToast(errorString(error), true);
    }
  }
  async function initializeCloud() {
    items = readLocal(); render(); updateAuthUI();
    if (!cloudConfigReady || !window.supabase?.createClient) return;
    try {
      client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      updateAuthUI();
      // Auth callback is intentionally scheduled separately: no async database queries in the auth callback.
      client.auth.onAuthStateChange((event, session) => {
        if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) {
          setTimeout(() => applySession(session), 0);
        }
      });
    } catch (error) {
      client = null; updateAuthUI();
      showToast('تعذّر تهيئة Supabase؛ يمكنك حفظ المواعيد محليًا.', true);
    }
  }
  async function importLocalItems() {
    if (!client || !user) return;
    const local = readLocal();
    if (!local.length) return;
    if (!window.confirm(`سيتم نقل ${local.length} موعد محلي إلى حسابك السحابي. هل تريد المتابعة؟`)) return;
    const button = $('#import-local');
    button.disabled = true;
    try {
      let remaining = local;
      while (remaining.length) {
        const chunk = remaining.slice(0, 50).map(item => ({
          user_id: user.id, item_type: item.item_type,
          title: item.title, item_date: item.item_date,
          item_time: item.item_time, subject: item.subject,
          notes: item.notes, completed: item.completed
        }));
        const { error } = await client.from('planner_items').insert(chunk);
        if (error) throw error;
        remaining = remaining.slice(chunk.length);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(remaining));
      }
      await applySession({ user });
      showToast('تم نقل المواعيد المحلية إلى حسابك ✓');
    } catch (error) {
      syncIssue = true; updateAuthUI();
      showToast('تعذّر نقل بعض المواعيد: ' + errorString(error), true);
    } finally {
      button.disabled = false;
      updateAuthUI();
    }
  }
  function chooseAuth(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    $$('[data-auth]').forEach(button => {
      const active = button.dataset.auth === authMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    setText('#auth-submit', authMode === 'signup' ? 'إنشاء الحساب' : 'تسجيل الدخول');
    $('#auth-password').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
    if (client) setText('#auth-notice', authMode === 'signup'
      ? 'قد تتلقى رسالة تأكيد على بريدك الإلكتروني قبل بدء المزامنة.'
      : 'استخدم نفس البريد وكلمة المرور على كل أجهزتك.');
  }
  async function submitAuth(event) {
    event.preventDefault();
    if (!client) return showToast('Supabase غير متاح حاليًا. افتح التطبيق مع اتصال بالإنترنت.', true);
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const nextUrl = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined;
      const { data, error } = authMode === 'signup'
        ? await client.auth.signUp({ email, password, options: nextUrl ? { emailRedirectTo: nextUrl } : {} })
        : await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (authMode === 'signup' && !data.session) {
        showToast('تم إرسال رسالة تأكيد إلى بريدك. افتحها لتفعيل الحساب.');
        setText('#auth-notice', 'افتح بريدك واضغط رابط التأكيد، ثم ارجع للتطبيق وسجّل الدخول.');
      } else {
        closeModal('auth');
        await applySession(data.session);
        showToast('تم تسجيل الدخول ✓');
      }
    } catch (err) { showToast(errorString(err), true); }
    finally { submit.disabled = false; }
  }
  async function logout() {
    if (!client) return;
    $('#logout-btn').disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      await applySession(null);
      closeModal('auth'); showToast('تم تسجيل الخروج. أنت الآن في وضع الحفظ المحلي.');
    } catch (error) { showToast(errorString(error), true); }
    finally { $('#logout-btn').disabled = false; }
  }

  function bindEvents() {
    ['add-top', 'add-hero', 'add-calendar', 'add-mobile'].forEach(id => $('#' + id).addEventListener('click', () => openItem()));
    $('#add-day').addEventListener('click', () => openItem());
    $('#prev-month').addEventListener('click', () => { viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() - 1, 1, 12); render(); });
    $('#next-month').addEventListener('click', () => { viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1, 12); render(); });
    $('#today-btn').addEventListener('click', () => { selectedDate = today(); viewedMonth = dateFromKey(today()); render(); });
    $$('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; syncFilters(); render(); }));
    $$('.type-option').forEach(button => button.addEventListener('click', () => pickType(button.dataset.type)));
    $('#item-form').addEventListener('submit', submitItem);
    $('#delete-item').addEventListener('click', deleteItem);
    $('#close-item').addEventListener('click', () => closeModal('item'));
    $('#cancel-item').addEventListener('click', () => closeModal('item'));
    $('#account-btn').addEventListener('click', () => { updateAuthUI(); openModal('auth'); });
    $('#close-auth').addEventListener('click', () => closeModal('auth'));
    $$('.overlay').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close)));
    $('#auth-form').addEventListener('submit', submitAuth);
    $$('[data-auth]').forEach(b => b.addEventListener('click', () => chooseAuth(b.dataset.auth)));
    $('#logout-btn').addEventListener('click', logout);
    $('#import-local').addEventListener('click', importLocalItems);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('#item-layer').classList.contains('hidden')) closeModal('item');
      else if (!$('#auth-layer').classList.contains('hidden')) closeModal('auth');
    });
    window.addEventListener('online', () => { if (user) applySession({ user }); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && user && syncIssue) applySession({ user }); });
    chooseAuth('login');
  }

  bindEvents();
  initializeCloud();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
