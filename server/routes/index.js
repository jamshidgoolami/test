/**
 * NetWatch — ثبت متمرکز مسیرهای API
 * ----------------------------------------------------------------
 * این ماژول فقط ترتیب سوارکردن Routerها را می‌داند. منطق هر دامنه در
 * `server/routes/<domain>.js` و سرویس‌های مشترک در `server/services/` است.
 */
import devicesRouter from './devices.js';
import attachmentsRouter from './attachments.js';
import templatesRouter from './templates.js';
import dashboardRouter from './dashboard.js';
import reportsRouter from './reports.js';
import opsRouter from './ops.js';
import inventoryRouter from './inventory.js';
import markersRouter from './markers.js';
import diagramsRouter from './diagrams.js';
import credentialsRouter from './credentials.js';
import auditRouter from './audit.js';
import systemRouter from './system.js';
import docsRouter from './docs.js';

/** مسیرها را روی app سوار می‌کند؛ فراخوانی دوباره مجاز نیست. */
export function mountApiRoutes(app) {
  // پیوست‌ها پیش از Router تجهیزات سوار می‌شوند تا مسیرهای
  // `/:id/attachments` بدون تکیه بر ترتیب تطبیق مسیرها همیشه در دسترس باشند.
  app.use('/api/devices', attachmentsRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', opsRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', markersRouter);
  app.use('/api/diagrams', diagramsRouter);
  app.use('/api/credentials', credentialsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/docs', docsRouter);
}
