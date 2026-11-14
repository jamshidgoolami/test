# پایش سرورهای ویندوزی Supermicro

> این ماژول CPU، RAM، هارد، ترافیک شبکه، دما و اطلاعات BMC سرورهای ویندوزی را جمع می‌کند. طراحی آن دو کاناله است: Agent سبک روی ویندوز برای متریک‌های سیستم‌عامل و BMC برای دما/سلامت سخت‌افزار. هیچ‌کدام جای دیگری را بازنویسی نمی‌کند.

## چرا دو کانال؟

ویندوز منبع خوبی برای CPU، RAM، Volume و شمارندهٔ NIC است، اما دمای معتبر مادربرد/CPU و سلامت درایوهای فیزیکی را نمی‌دهد. `Win32_TemperatureProbe` در بسیاری از سرورها مقدار معتبر یا `CurrentReading` قابل‌اتکا ندارد. در مقابل BMC دما، فن، ولتاژ، توان، DIMM و درایو را می‌داند، ولی مصرف RAM و نرخ واقعی ترافیک ویندوز را نمی‌داند.

بنابراین:

| داده | منبع اصلی | توضیح |
|---|---|---|
| CPU % | Agent ویندوز | `Win32_PerfFormattedData_PerfOS_Processor` |
| RAM | Agent ویندوز | `Win32_OperatingSystem` |
| Volume (C:, D:) | Agent ویندوز | `Win32_LogicalDisk` |
| هارد فیزیکی، سلامت، دما، Wear | BMC (Redfish/IPMI) + Agent | Agent برای `Get-PhysicalDisk` و BMC برای سلامت/دما |
| ترافیک ورودی/خروجی | Agent ویندوز | delta شمارندهٔ `Get-NetAdapterStatistics` |
| دما، فن، ولتاژ، توان | BMC | Redfish `Thermal`/`Sensors` یا IPMI `sdr` |
| موجودی Supermicro، BIOS، BMC firmware | BMC + Agent | Redfish/FRU و `Win32_ComputerSystem` |

`source` در همهٔ جدول‌های snapshot نگه داشته می‌شود؛ دادهٔ Agent، Redfish، IPMI و Demo روی هم بازنویسی نمی‌شوند.

## معماری

```
┌──────────────────────┐        HTTPS + Bearer Token        ┌──────────────────────┐
│ Windows Server       │ ─────────────────────────────────► │ NetWatch             │
│ NetWatchAgent.ps1    │   POST /api/agent/metrics          │ server-monitoring/   │
│ (Scheduled Task)     │                                    │  normalize/store     │
└──────────────────────┘                                    │  poller              │
                                                            │  redfish/ipmi        │
┌──────────────────────┐        HTTPS (Redfish)             │                      │
│ Supermicro BMC       │ ◄───────────────────────────────── │  SQLite              │
│ Redfish / IPMI 2.0   │   GET sensors, thermal, storage    │  servers/metrics/... │
└──────────────────────┘                                    └──────────────────────┘
```

* Agent فقط **خروجی** به NetWatch دارد؛ روی سرور پایش‌شده پورت جدیدی باز نمی‌شود.
* NetWatch به BMC در شبکهٔ مدیریت وصل می‌شود. BMC معمولاً گواهی self-signed دارد؛ یا CA آن را در تنظیمات سرور وارد کنید یا `bmc_verify_tls` را صریحاً خاموش کنید.
* Polling با فاصلهٔ هر سرور (پیش‌فرض ۶۰ ثانیه، حداقل ۳۰) و حداکثر دو سرور هم‌زمان اجرا می‌شود. BMC یک SoC کوچک است و Poll پرفرکانس/هم‌زمان زیاد باعث timeout و قفل session می‌شود.

## مدل داده

Migration 24 جدول‌های زیر را می‌سازد و Migration 25 آستانه‌های هشدار را به `servers` و `alerts` اضافه می‌کند:

* `servers`: هویت سرور، توکن Agent (فقط hash SHA-256)، اعتبارنامهٔ رمزنگاری‌شدهٔ BMC، تنظیمات Poll و آخرین خطا.
* `server_metrics`: سری زمانی سبک CPU/RAM/disk/network/delta/temp/power/health.
* `server_inventory`: سازنده، مدل، سریال، BIOS، BMC firmware، CPU، RAM، DIMM/PSU.
* `server_disks`: Volumeها و درایوهای فیزیکی، با `source`.
* `server_nics`: کارت‌ها، MAC، سرعت، RX/TX و خطاها.
* `server_sensors`: دما/فن/ولتاژ/توان و آستانه‌ها.

تاریخچهٔ متریک با `NETWATCH_SERVER_METRICS_DAYS` (پیش‌فرض ۳۰ روز) هر شش ساعت پاک‌سازی می‌شود. `server_metrics` عمداً از `devices` جدا است تا تاریخچهٔ سنگین و اعتبارنامهٔ BMC، جدول تجهیزات شبکه را شلوغ نکند.

## نصب Agent روی ویندوز

پیش‌نیاز: Windows Server 2016+ و PowerShell 5.1.

1. در NetWatch سرور را اضافه کنید. توکن Agent **فقط یک‌بار** در پنجرهٔ توستن نمایش داده می‌شود.
2. پوشهٔ `deploy/server-agent` را روی سرور کپی کنید.
3. PowerShell را با دسترسی Administrator باز کنید:

```powershell
.\Install-NetWatchAgent.ps1 `
  -ServerUrl https://netwatch.example.local:8080 `
  -Token nw_... `
  -IntervalSec 30
```

4. وضعیت:

```powershell
Get-ScheduledTask -TaskName NetWatchAgent | Get-ScheduledTaskInfo
Get-Content "$env:ProgramFiles\NetWatchAgent\agent.log" -Tail 20
```

اسکریپت نصب:

* توکن را در `C:\Program Files\NetWatchAgent\agent.json` می‌نویسد و ACL را به SYSTEM و Administrators محدود می‌کند.
* یک Scheduled Task با کاربر SYSTEM و AtStartup می‌سازد. PowerShell نمی‌تواند پروتکل SCM را پیاده کند؛ بنابراین سرویس ساختگی نمی‌سازیم. Task همان رفتار always-on را با restart خودکار دارد.
* اگر NetWatch گواهی داخلی دارد، `-CaCertPath` را بدهید تا گواهی در `LocalMachine\Root` نصب شود. بدون آن، `Invoke-RestMethod` گواهی self-signed را رد می‌کند.

حذف:

```powershell
.\Install-NetWatchAgent.ps1 -Uninstall
```

فایروال:

* روی سرور ویندوزی: فقط outbound به پورت NetWatch (معمولاً 8080/443). هیچ inbound لازم نیست.
* روی سرور NetWatch: inbound به پورت وب برای Agent و outbound به پورت 443 BMC در شبکهٔ مدیریت.
* اگر Agent روی همان سرور NetWatch اجرا می‌شود، از `http://127.0.0.1:8080` استفاده کنید؛ توکن همچنان لازم است.

## Redfish

مسیر پیشنهادی برای Supermicro نسل X10/H11 به بعد:

* `GET /redfish/v1/Systems/1`
* `GET /redfish/v1/Managers/1`
* `GET /redfish/v1/Chassis/1/Thermal` (نسل قدیمی‌تر)
* `GET /redfish/v1/Chassis/1/Power`
* `GET /redfish/v1/Chassis/1/Sensors` (+ هر sensor)
* `GET /redfish/v1/Chassis/1/ThermalSubsystem/ThermalMetrics`
* `GET /redfish/v1/Systems/1/Storage` → Drives
* `GET /redfish/v1/Systems/1/Processors`
* `GET /redfish/v1/Systems/1/Memory`
* `GET /redfish/v1/Systems/1/EthernetInterfaces`

پیاده‌سازی:

* Session login (`/SessionService/Sessions`) و در صورت نبود، Basic روی HTTPS. Session در `finally` بسته می‌شود.
* پاسخ حداکثر ۲ MiB و هر درخواست timeout ۱۰ ثانیه دارد. خطای یک endpoint اختیاری (403/404) کل Poll را خراب نمی‌کند.
* دمای Sensors جدید و Thermal قدیمی هر دو خوانده می‌شوند؛ سنسور تکراری با `sensorKey` حذف می‌شود.
* برای BMC با گواهی self-signed: `bmc_ca_pem` را در فرم (تنظیمات پیشرفته) وارد کنید. `bmc_verify_tls=0` فقط گزینهٔ صریح و قابل‌مشاهده است، نه پیش‌فرض.
* برخی endpointها به firmware/license (مثل SFT-DCMS-SINGLE) وابسته‌اند. اگر Storage برنگشت، Volumeهای Agent همچنان نمایش داده می‌شوند.

## IPMI 2.0 (fallback)

Redfish روی همهٔ BMCهای قدیمی Supermicro کامل نیست. برای این موارد `bmc_protocol=ipmi` را انتخاب کنید. NetWatch از `ipmitool` رسمی استفاده می‌کند:

* `mc info` → سازنده/محصول/firmware
* `sdr` → سنسورها (دما، فن، ولتاژ، توان) و وضعیت `ok/nc/cr`
* `fru` → موجودی اولیه
* `chassis power status` → وضعیت روشن/خاموش

نصب `ipmitool`:

* ویندوز: `ipmitool.exe` را از بستهٔ رسمی/سازنده نصب کنید و مسیر آن را در `NETWATCH_IPMITOOL` بگذارید (یا در PATH).
* لینوکس: `apt install ipmitool` / `dnf install ipmitool`.

رمز IPMI از آرگومان خط فرمان عبور نمی‌کند؛ با `-E` و متغیر محیطی `IPMI_PASSWORD` فقط به فرآیند فرزند داده می‌شود. خروجی محدود و هر فرمان timeout دارد.

محدودیت IPMI: نرخ ترافیک و مصرف RAM را نمی‌دهد؛ این‌ها را Agent تأمین می‌کند. ظرفیت دیسک هم در IPMI استاندارد معمولاً موجود نیست.

## API

همهٔ مسیرها به‌جز Agent پشت احراز هویت و مجوز هستند:

| متد | مسیر | مجوز |
|---|---|---|
| GET | `/api/servers` | `servers:read` |
| GET | `/api/servers/:id` | `servers:read` |
| GET | `/api/servers/:id/metrics?range=1h` | `servers:read` |
| POST | `/api/servers` | `servers:write` |
| PATCH | `/api/servers/:id` | `servers:write` |
| POST | `/api/servers/:id/collect` | `servers:write` |
| POST | `/api/servers/:id/rotate-agent-token` | `servers:write` |
| DELETE | `/api/servers/:id` | `servers:write` |
| POST | `/api/servers/demo` | `servers:write` |
| POST | `/api/agent/metrics` | Bearer token سرور |

`POST /api/agent/metrics` عمداً پیش از `requireAuth` سوار شده است؛ Agent نشست مرورگر/CSRF ندارد. اعتبار آن تنها توکن اختصاصی سرور است که فقط hash آن ذخیره می‌شود. پاسخ توکن خام فقط در create/rotate برگردانده می‌شود.

Rangeهای مجاز: `15m, 1h, 6h, 24h, 7d, 30d`.

## امنیت

* توکن Agent: ۳۲ بایت تصادفی، پیشوند `nw_`، ذخیرهٔ SHA-256. توکن خام در لاگ/پایگاه‌داده نمی‌ماند. چرخش توکن، Agent قبلی را فوراً باطل می‌کند.
* اعتبارنامهٔ BMC با AES-256-GCM و AAD شامل `server:<id>` رمزنگاری می‌شود. رمز هرگز به API برنمی‌گردد؛ فقط `hasBmcPassword` و نام کاربری برای فرم.
* Agent هیچ رمزی از BMC ندارد. NetWatch تنها کسی است که به BMC وصل می‌شود.
* `bmc_verify_tls` پیش‌فرض روشن است؛ خاموش‌کردن آن باید آگاهانه و در فرم قابل‌مشاهده باشد.
* ورودی Agent با محدودیت اندازه/تعداد (۱۲۸ دیسک، ۶۴ NIC، ۲۵۶ سنسور) و بازه‌های عددی اعتبارسنجی می‌شود.
* توصیه: BMC را در VLAN مدیریت جدا نگه دارید و از همان مسیر، فقط NetWatch را مجاز کنید.

## هشدار آستانه‌ای، اعلان کلاینت و صدای اژیر

هر سرور سه آستانهٔ مستقل دارد که در فرم افزودن/ویرایش سرور تنظیم می‌شوند:

| آستانه | پیش‌فرض | منبع داده |
|---|---|---|
| CPU | ۹۰٪ | Agent ویندوز |
| RAM | ۹۰٪ | Agent ویندوز |
| دما | ۸۰°C | BMC (Redfish/IPMI) یا Agent در صورت وجود دمای دیسک |

رفتار:

* ارزیابی در همان لحظهٔ `ingestSnapshot` انجام می‌شود؛ یعنی هم برای Push Agent و هم برای Poll دوره‌ای BMC و هم برای دکمهٔ «خواندن BMC».
* عبور از آستانه یک ردیف در `alerts` با `server_id` و `kind`های `server_cpu`، `server_mem` یا `server_temp` می‌سازد. `duplicate_key` از تکرار هشدار در هر Poll جلوگیری می‌کند.
* هشدار از همان کانال SSE (`alert`) به همهٔ کلاینت‌های متصل می‌رود؛ App علاوه بر Toast، در صورت فعال بودن `notify_sound` صدای اژیر Web Audio پخش می‌کند.
* مرورگرها پخش صدا پیش از اولین تعامل را مسدود می‌کنند؛ اولین کلیک/لمس/کلید در صفحه، AudioContext را فعال می‌کند و اگر هشداری پیش از آن رسیده باشد، در همان لحظه پخش می‌شود.
* با بازگشت مقدار به محدودهٔ مجاز، همان هشدار به‌صورت خودکار `resolved` می‌شود. `alert_cooldown` از دوباره‌شمردن سریع پس از نوسان جلوگیری می‌کند.
* آستانه‌ها را می‌توان با `alertEnabled=false` برای یک سرور خاص خاموش کرد؛ تنظیم `notify_sound` در صفحهٔ تنظیمات، صدا را برای همهٔ کلاینت‌ها خاموش/روشن می‌کند.

## Demo

برای توسعه/آموزش بدون سخت‌افزار، در صفحهٔ سرورها «سرور نمایشی» را بزنید. `bmc_protocol=demo` یک snapshot مصنوعی با دما، فن، توان، ۴ درایو و ۴ Volume تولید می‌کند. داده در UI با برچسب «نمایشی» مشخص است و هرگز با دادهٔ واقعی اشتباه نمی‌شود. برای آزمون هشدار، آستانه‌های همان سرور را پایین بیاورید و «خواندن BMC» را بزنید.

## محدودیت‌ها و آزمون

* دما در ویندوز از WMI گرفته **نمی‌شود**؛ منبع آن BMC است.
* درایوهای RAID سخت‌افزاری ممکن است از `Get-PhysicalDisk` دیده نشوند؛ در این حالت سلامت/دما را BMC (Redfish Storage) تأمین می‌کند.
* IPMI به `ipmitool` خارجی وابسته است و در بستهٔ Portable ویندوز همراه نیست.
* در این محیط توسعه (macOS) ویندوز/Supermicro/BMC واقعی وجود ندارد؛ Migration، store، normalization، هشدار و build تست شده‌اند، اما اجرای واقعی PowerShell Agent و Redfish/IPMI نیازمند سرور و BMC واقعی است.
* صدای اژیر به سیاست Autoplay مرورگر وابسته است؛ در تب‌های کاملاً بدون تعامل، مرورگر ممکن است تا اولین کلیک از پخش جلوگیری کند. این محدودیت مرورگر است، نه خطای سرور.
* هشدارهای آستانه‌ای سرور در همان مرکز هشدار هستند، اما قوانین `alert_rules` فعلی فقط برای متریک‌های تجهیزات شبکه‌اند؛ آستانه‌های سرور روی خود سرور نگه‌داری می‌شوند.
