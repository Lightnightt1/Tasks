# StudyGlass — النسخة المرتبطة بمشروع Tasks الصحيح

## مهم قبل النشر
هذه النسخة مهيأة لمشروع Supabase الصحيح:
- Project ref: `ozhiklonwyjlerpouglf`
- URL: `https://ozhiklonwyjlerpouglf.supabase.co`
- GitHub Pages: `https://lightnightt1.github.io/Tasks/`

## ما تم تجهيزه
- واجهة التقويم الزجاجية بالأبيض والرصاصي.
- `config.js` محدث ليتصل بمشروع Tasks الصحيح.
- `schema.sql` لإنشاء جدول المواعيد وسجل التذكيرات مع RLS.
- `setup-reminder-vault.sql` لربط سر الجدولة بين Vault والدالة.

## رفع الموقع
1. فك ضغط الملف.
2. افتح مستودع https://github.com/lightnightt1/Tasks
3. ارفع جميع الملفات إلى جذر المستودع ووافق على الاستبدال.
4. اضغط Commit changes وانتظر نشر GitHub Pages.
5. افتح https://lightnightt1.github.io/Tasks/ ثم سجّل الدخول أو أنشئ حسابًا في مشروع Supabase الجديد.

## تفعيل سر الجدولة
1. في Supabase > Edge Function Secrets تأكد من وجود `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STUDYGLASS_CRON_SECRET`.
2. افتح `setup-reminder-vault.sql` واستبدل `PASTE_THE_STUDYGLASS_CRON_SECRET_HERE` بالقيمة نفسها تمامًا التي حفظتها في `STUDYGLASS_CRON_SECRET`.
3. شغّل الملف في SQL Editor الخاص بمشروع Tasks.
4. وظيفة `send-studyglass-reminders` والجدولة موجودتان بالفعل في هذا المشروع.

ملاحظة: البيانات الموجودة في مشروع Supabase القديم لا تنتقل تلقائيًا إلى المشروع الجديد. يلزم تسجيل الدخول بحساب جديد في المشروع الصحيح؛ يمكن نقل المواعيد القديمة لاحقًا إذا لزم الأمر.

لا ترفع مفاتيح Resend أو أي أسرار إلى GitHub. المفتاح الوحيد في `config.js` هو Publishable Key المخصص للمتصفح.
