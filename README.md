# PMP Data Record — Desktop App

نسخة سطح المكتب المستقلة من نظام PMP Data Sheet V1. تم نقل المشروع من Excel VBA + IE11 إلى **Electron + SQLite + Chromium**، مع الحفاظ على نفس الواجهة ونفس منطق العمل ونفس البيانات.

## المتطلبات

- **Node.js** 18 أو أحدث ([nodejs.org](https://nodejs.org))
- **Windows 10/11** 64-bit (للبناء والتوزيع)
- **Visual Studio Build Tools** (للـ native modules — يُثبَّت تلقائياً مع Node في بعض الحالات، أو حمّله يدوياً إذا فشل `npm install`)

## الإعداد الأول

```bash
# 1) تثبيت الاعتماديات
npm install

# 2) إعادة بناء better-sqlite3 لـ Electron (مرة واحدة)
npm run rebuild

# 3) تشغيل البرنامج في وضع التطوير
npm run dev
```

عند أول تشغيل سيتم:
- إنشاء قاعدة بيانات جديدة في `./userdata/pmp.db` (وضع التطوير) أو `%APPDATA%/PMP Data Record/pmp.db` (وضع الإنتاج)
- إنشاء مستخدم إداري افتراضي: **admin / admin** — يُطلب تغيير كلمة السر عند أول دخول

## النقل من Excel

لنقل البيانات من الـ `.xlsm` الحالي:

1. سجّل الدخول كـ admin
2. اذهب إلى **الإعدادات → نقل من Excel** (في الواجهة) — أو من سطر الأوامر:

```bash
# ضع PMP_Data_Sheet_V1.xlsm في المجلد ثم:
npm run migrate
```

ما يتم نقله:
- **Settings sheet** → `clients`, `providers`, `lookups`
- **Services sheet** → `orders` (مع تخمين الكاتيجوري من اسم الخدمة)
- **Users sheet** → `users` (كلها تبدأ بكلمة سر `changeme` — يُطلب تغييرها عند أول دخول)

الهاشات القديمة تُحفظ في `legacy_hash` للرجوع إليها إن لزم.

## البناء للإنتاج

```bash
# Installer .exe (NSIS)
npm run build

# أو نسخة portable (بلا تنصيب)
npm run build:portable
```

الناتج في مجلد `dist/`.

## الأدوار (Roles)

| Role | الوصول |
|---|---|
| `admin` | كل شيء + إدارة المستخدمين + الأسعار |
| `manager` | كل شيء ماعدا المستخدمين |
| `coordination` | كل شيء لكن **بلا بيانات مالية** (revenue/cost/profit مخفية تلقائياً) |
| `user` | قراءة فقط + إنشاء طلبات |

## هيكل المشروع

```
pmp-desktop/
├── main.js                      # Electron main + IPC
├── preload.js                   # window.pmp API bridge
├── src/
│   ├── db/
│   │   ├── schema.sql           # SQLite schema
│   │   ├── database.js          # DB wrapper
│   │   └── migrate-from-excel.js
│   ├── services/                # منطق العمل (بديل modules VBA)
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── clients.js
│   │   ├── providers.js
│   │   ├── orders.js
│   │   └── pricing.js
│   └── renderer/                # الواجهات (HTML/CSS/JS)
│       ├── login.html
│       ├── css/styles.css
│       ├── js/ (api, login, dashboard, ...)
│       └── pages/ (dashboard.html, ...)
└── assets/icon.ico              # أيقونة البرنامج (ضعها يدوياً)
```

## الفرق الجوهري عن النسخة السابقة

| VBA + IE11 | Electron + SQLite |
|---|---|
| `document.title = 'CMD:...'` polling | `window.pmp.*` IPC (غير متزامن، نظيف) |
| COM disconnections عشوائية | ثابت — لا COM |
| IE11 limitations | Chromium كامل |
| تواريخ معطوبة بسبب Arabic locale | ISO everywhere داخلياً، عرض يدوي بلا `CDate` |
| ملف `.xlsm` واحد | `.exe` مستقل + `pmp.db` في AppData |
| Users في sheet | bcrypt في جدول `users` |

## 🌐 الوصول من أجهزة أخرى (LAN)

البرنامج يشغّل سيرفر داخلي على المنفذ **3737** (قابل للتغيير). أي جهاز على نفس شبكة الواي فاي / الشبكة المحلية يستطيع الدخول بمتصفحه إلى نفس النظام بنفس اسم المستخدم وكلمة المرور.

### التفعيل
1. شغّل البرنامج على الجهاز الرئيسي (`npm run dev` أو الـ `.exe`)
2. سجّل دخول كـ admin → **الإعدادات**
3. في قسم "وصول الشبكة المحلية" → اضغط **تفعيل**
4. Windows Firewall سيطلب الإذن → اضغط **Allow**
5. سترى عناوين مثل `http://192.168.1.42:3737` — شارك هذا الرابط

### الدخول من جهاز آخر
- افتح أي متصفح (Chrome, Edge, Safari على iPad/iPhone، إلخ)
- ادخل الرابط المعروض في الإعدادات
- سجّل دخول بنفس اسم المستخدم وكلمة المرور
- ✅ نفس الواجهة، نفس البيانات، بنفس صلاحيات الدور (role)

### الأمان
- جميع الطلبات تمر عبر bcrypt + cookies آمنة (`httpOnly`, `sameSite=lax`)
- Rate-limit على تسجيل الدخول (10 محاولات/دقيقة/IP)
- الجلسات تنتهي تلقائياً بعد 12 ساعة من الخمول
- `admin` وحده يستطيع تفعيل/تعطيل الوصول الشبكي
- التحكم بالخادم (تشغيل/إيقاف) متاح فقط من الجهاز الرئيسي — أجهزة المتصفح لا تستطيع إيقاف الخادم (حماية من تعطيل النظام عن بُعد)
- الأدوار محفوظة: `coordination` لا يرى المبالغ حتى من المتصفح

### ملاحظة مهمة
- الجهاز الرئيسي يجب أن يبقى شغّالاً — هو يستضيف قاعدة البيانات والخادم
- البيانات لا تُكرر على الأجهزة الأخرى — كلها تقرأ/تكتب من نفس `pmp.db`
- إذا لم يعمل الرابط: تأكد أن جميع الأجهزة على **نفس الشبكة**، وأن Firewall سامح بالمنفذ

---

## البنية الداخلية

البرنامج له قناتان متوازيتان لنفس المنطق:

```
┌─────────────────────────────┐      ┌──────────────────────────┐
│  Electron Window (host)     │      │ Browser (LAN devices)    │
│  - file:// pages            │      │ - http://host-ip:3737    │
│  - window.pmp = IPC         │      │ - window.pmp = fetch()   │
└──────────────┬──────────────┘      └───────────┬──────────────┘
               │                                 │
               ▼                                 ▼
          [IPC handlers]                    [Express routes]
               │                                 │
               └────────────┬────────────────────┘
                            ▼
                  ┌─────────────────────┐
                  │  Services layer     │
                  │  (auth, orders,     │
                  │   clients, ...)     │
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │  SQLite (pmp.db)    │
                  └─────────────────────┘
```

**نفس الخدمات بالضبط** تُستخدم من الطرفين، مما يضمن عدم تكرار المنطق.

---



---

## Roadmap

- [x] **Phase 1**: Foundation (auth, DB, migration, login, dashboard)
- [x] **Phase 1b**: LAN server (Express + session cookies)
- [x] **Phase 2**: Orders (New + Edit) + Clients + Providers
- [x] **Phase 3**: Pricing UI + Copy Order + Bulletproof Excel migration
- [x] **Phase 4**: Reports page + Excel export + Audit log viewer

## الميزات المكتملة

### البرنامج الأساسي
- ✅ تسجيل دخول bcrypt + جلسات آمنة
- ✅ أدوار (admin / manager / coordination / user) مع إخفاء البيانات المالية تلقائياً
- ✅ لوحة تحكم مع KPIs وبحث فوري وأحدث السجلات
- ✅ LAN access — دخول من أي متصفح على الشبكة المحلية
- ✅ سجل عمليات (audit log) لكل الأحداث

### الطلبات (Orders)
- ✅ **4 فئات** بقواعد مختلفة: Live / Package / Space / Crew
- ✅ WO تلقائي بصيغة `CODE-0000` مع atomic counter
- ✅ Auto-pricing من محرك أسعار متعدد الطبقات
- ✅ **Copy Order** — زر "نسخ كطلب جديد"
- ✅ تعديل/حذف مع حماية صلاحيات

### الأسعار (Pricing)
- ✅ **3 tabs**: Default / Client-specific / Provider costs
- ✅ تفضيل أسعار العميل على الافتراضية تلقائياً
- ✅ حساب Revenue / Cost / Profit لحظياً
- ✅ إضافة/حذف أسعار

### التقارير (Reports)
- ✅ فلاتر متعددة (تاريخ / عميل / مزود / فئة / حالة / بحث)
- ✅ 4 بطاقات ملخص: إجمالي الطلبات / الإيرادات / التكاليف / الربح
- ✅ تصنيف حسب حالة الدفع وحسب أعلى 10 عملاء
- ✅ **تصدير Excel** مع ورقة Summary منسقة
- ✅ تنزيل مباشر للأجهزة المتصلة بالشبكة

### النقل من Excel (Bulletproof)
- ✅ مسح مرحلتين — يجمع كل الكيانات الفريدة من كل Sheets قبل الإدراج
- ✅ إنشاء تلقائي لأكواد العملاء الناقصة
- ✅ تخمين ذكي للفئة (Live/Package/Space/Crew) من اسم الخدمة
- ✅ دعم جميع أنواع التواريخ (dd.mm.yyyy, dd/mm/yyyy, Excel serial)
- ✅ دعم جميع أنواع الأوقات (fractions, datetime.time, strings)
- ✅ تقرير تفصيلي بعد الاستيراد (العدد + التنبيهات + الأخطاء)
- ✅ قابل للتكرار (re-runnable) بلا تكرار بيانات

## استخدام صفحة الإعدادات

- **تغيير كلمة المرور**: متاح لكل المستخدمين
- **التحكم بـ LAN**: admin فقط (من الجهاز الرئيسي)
- **استيراد من Excel**: admin فقط (يفتح File Picker)
- **سجل العمليات**: admin فقط (آخر 50 عملية)

## ملاحظات مهمة

- **النسخ الاحتياطي**: نسخ `%APPDATA%/PMP Data Record/pmp.db` يكفي لحفظ كامل النظام
- **تعدد المستخدمين على نفس الجهاز**: المستخدمون يدخلون بحسابات مختلفة على نفس DB
- **التواريخ**: كلها داخلياً بصيغة `yyyy-mm-dd` (ISO) — لا مشاكل locale مرة أخرى
- **Crash logs**: في `audit_log` table داخل الـ DB
