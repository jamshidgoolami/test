/**
 * SMCIPMITool adapter: parser-only tests with output copied from the
 * Supermicro user guide. No BMC, Windows executable, or database is required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

if (!process.env.PORT || process.env.PORT === '0') process.env.PORT = '18778';
const { buildSnapshot, parseMeasurement, parseNics, parsePowerState, parseSensors, parseSel } = await import(
  '../../server-monitoring/smcipmi.js'
);

const SENSOR_OUTPUT = `Getting SDR data ...
Getting sensors ...
Status | (#)Sensor | Reading | Low Limit | High Limit |
------ | --------- | ------- | --------- | ---------- |
OK | (7) CPU1 Temp | Low | | |
OK | (9) System Temp | 63C/145F | -5C/23F | 75C/167F |
OK | (10) CPU1 Vcore | 0.92 V | 0.82 V | 1.35 V |
| (20) Fan2 | 0 RPM | 675 RPM | 34155 RPM |
OK | (27) P1-DIMMA1 Temp | 47C/117F | -5C/23F | 75C/167F |
| (28) P1-DIMM1B Temp | N/A | -5C/23F | 75C/167F |
CR | (39) Intrusion | 00 C0 00 00 | N/A | N/A |
OK | (40) PS Status | 00 C0 00 00 | N/A | N/A |
`;

test('SMCIPMITool sensor table keeps values, units, limits and statuses', () => {
  const sensors = parseSensors(SENSOR_OUTPUT);
  assert.equal(sensors.length, 8);

  const system = sensors.find((s) => s.name === 'System Temp');
  assert.deepEqual(
    { type: system.type, reading: system.reading, unit: system.unit, status: system.status },
    { type: 'temperature', reading: 63, unit: 'C', status: 'ok' }
  );
  assert.equal(system.lowerCritical, -5);
  assert.equal(system.upperCritical, 75);

  const fan = sensors.find((s) => s.name === 'Fan2');
  assert.equal(fan.reading, 0);
  assert.equal(fan.unit, 'RPM');
  assert.equal(fan.status, 'unknown', 'a blank status is not silently treated as OK');

  const cpu = sensors.find((s) => s.name === 'CPU1 Temp');
  assert.equal(cpu.reading, null, 'the text reading Low is not a measurement');
  assert.equal(sensors.find((s) => s.name === 'PS Status').type, 'power');
  assert.equal(sensors.find((s) => s.name === 'Intrusion').status, 'critical');
});

test('SMCIPMITool measurements convert Fahrenheit and ignore raw status bytes', () => {
  assert.deepEqual(parseMeasurement('63C/145F'), { reading: 63, unit: 'C', text: '63C/145F' });
  assert.deepEqual(parseMeasurement('145F'), { reading: (145 - 32) * (5 / 9), unit: 'C', text: '145F' });
  assert.equal(parseMeasurement('00 C0 00 00').reading, null);
  assert.equal(parseMeasurement('N/A').reading, null);
});

test('power state, NIC table and SEL parser tolerate vendor table headers', () => {
  assert.equal(parsePowerState('Power is on'), 'on');
  assert.equal(parsePowerState('Power Status : Off'), 'off');

  const nics = parseNics(`Name | Status | MAC |
------ | ------ | --- |
OnBoard_NIC1 | LinkUp | 3C:EA:FF:FB:78:1A
OnBoard_NIC2 | LinkDown | 3C:EA:FF:FB:78:1B`);
  assert.deepEqual(
    nics.map((n) => [n.name, n.linkStatus, n.mac]),
    [
      ['OnBoard_NIC1', 'up', '3C:EA:FF:FB:78:1A'],
      ['OnBoard_NIC2', 'down', '3C:EA:FF:FB:78:1B'],
    ]
  );

  const sel = parseSel('1 | 01/01/2025 | 12:00:00 | Temperature | Upper Critical');
  assert.equal(sel.count, 1);
  assert.match(sel.entries[0], /Upper Critical/);
});

test('buildSnapshot maps FRU, firmware, MAC and health into the common server model', () => {
  const snapshot = buildSnapshot(
    {
      sensorOutput: SENSOR_OUTPUT,
      powerOutput: 'Power is on',
      fruOutput: `Product Manufacturer Name = Super Micro
Product Name = SSG-631E-E1CR16L
Product Serial Number = S123456
Board Product Name = X13DEI-T`,
      summaryOutput: `IP : 192.168.1.50
MAC Address : 00:25:90:5D:2F:63
Firmware Revision : 1.23
CPLD Version : 02.b1.01`,
      macOutput: 'OnBoard_NIC1 | LinkUp | 3C:EA:FF:FB:78:1A',
    },
    1720000000000
  );

  assert.equal(snapshot.metric.source, 'ipmi');
  assert.equal(snapshot.metric.maxTempC, 63);
  assert.equal(snapshot.metric.health, 'critical');
  assert.equal(snapshot.inventory.manufacturer, 'Super Micro');
  assert.equal(snapshot.inventory.model, 'SSG-631E-E1CR16L');
  assert.equal(snapshot.inventory.serial, 'S123456');
  assert.equal(snapshot.inventory.bmcFirmware, '1.23');
  assert.equal(snapshot.inventory.dimmCount, 1);
  assert.equal(snapshot.inventory.raw.adapter, 'smcipmi');
  assert.equal(snapshot.inventory.raw.bmcMac, '00:25:90:5D:2F:63');
  assert.equal(snapshot.inventory.raw.powerState, 'on');
  assert.equal(snapshot.raw.source, 'ipmi');
  assert.equal(snapshot.nics.length, 1);
});

test('buildSnapshot rejects an empty sensor table with an actionable message', () => {
  assert.throws(() => buildSnapshot({ sensorOutput: 'Getting SDR data ...\n' }), /سنسوری برنگرداند/);
});
