# NetWatch Windows Server Agent

Agent سبک برای ارسال CPU، RAM، Volume، هارد فیزیکی و ترافیک NIC به NetWatch.

## نصب سریع

روی سرور ویندوزی، PowerShell را با Administrator باز کنید:

```powershell
.\Install-NetWatchAgent.ps1 `
  -ServerUrl https://netwatch.example.local:8080 `
  -Token nw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

توکن را از NetWatch، صفحهٔ «پایش سرورها» → افزودن سرور → پنجرهٔ توکن بردارید. توکن فقط یک‌بار نمایش داده می‌شود.

## فایل‌ها

| فایل | نقش |
|---|---|
| `NetWatchAgent.ps1` | جمع‌آوری و ارسال متریک؛ حلقهٔ اصلی |
| `Install-NetWatchAgent.ps1` | نصب/حذف Scheduled Task، نوشتن config و ACL، نصب CA اختیاری |
| `agent.json` (ساختهٔ نصب) | `serverUrl`، `token`، `intervalSec` — ACL محدود به SYSTEM/Administrators |
| `agent.log` (ساختهٔ Agent) | لاگ چرخشی ۵ MiB |

## گزینه‌های نصب

```powershell
# فاصلهٔ ۶۰ ثانیه
.\Install-NetWatchAgent.ps1 -ServerUrl https://nw:8080 -Token nw_... -IntervalSec 60

# NetWatch با گواهی self-signed: CA را در LocalMachine\Root نصب کن
.\Install-NetWatchAgent.ps1 -ServerUrl https://nw:8080 -Token nw_... -CaCertPath .\netwatch-ca.crt

# حذف کامل
.\Install-NetWatchAgent.ps1 -Uninstall
```

## بررسی

```powershell
Get-ScheduledTask -TaskName NetWatchAgent | Get-ScheduledTaskInfo
Get-Content "$env:ProgramFiles\NetWatchAgent\agent.log" -Tail 30

# اجرای یک‌باره برای عیب‌یابی (نیاز به config نصب‌شده)
powershell -ExecutionPolicy Bypass -File "$env:ProgramFiles\NetWatchAgent\NetWatchAgent.ps1" -Once
```

## فایروال و شبکه

* سرور پایش‌شده: فقط **outbound** به NetWatch (8080/443). هیچ inbound لازم نیست.
* NetWatch: inbound به پورت وب برای Agent؛ outbound به 443 BMC در VLAN مدیریت.
* اگر Agent روی همان میزبان NetWatch است: `-ServerUrl http://127.0.0.1:8080`.

## نکات

* PowerShell 5.1 روی Windows Server 2016+ کافی است.
* Agent به‌صورت Task با کاربر SYSTEM اجرا می‌شود، نه سرویس SCM؛ این انتخاب آگاهانه است چون اسکریپت PowerShell نمی‌تواند پروتکل سرویس ویندوز را پیاده کند.
* توکن را در command line روزمره نگذارید؛ فقط هنگام نصب. فایل `agent.json` با ACL محافظت می‌شود.
* دما از BMC خوانده می‌شود، نه از WMI؛ Agent فقط دمای درایو فیزیکی (اگر Storage Reliability آن را بدهد) را می‌فرستد.
