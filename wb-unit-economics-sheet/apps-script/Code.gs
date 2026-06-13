/**
 * Юнит-экономика WB — отдельная Google Таблица
 * Меню: «Юнитка WB» → «Создать / обновить таблицу»
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Юнитка WB')
    .addItem('Создать / обновить таблицу', 'setupSpreadsheet')
    .addItem('Обновить формулы (строки 2–2002)', 'applyFormulas')
    .addToUi();
}

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSettingsSheet_(ss);
  setupPurchaseSheet_(ss);
  setupCommissionSheet_(ss);
  setupMainSheet_(ss);
  importSeedData_(ss);
  applyFormulas();
  ss.setActiveSheet(ss.getSheetByName('Юнитка'));
  SpreadsheetApp.getUi().alert('Готово! Заполните артикулы и цены продажи в листе «Юнитка».');
}

function setupSettingsSheet_(ss) {
  const sheet = ss.getSheetByName('_Настройки') || ss.insertSheet('_Настройки');
  sheet.clear();
  const rows = [
    ['Параметр', 'Значение', 'Описание'],
    ['Налог УСН Доходы', 0.11, 'Доля от цены продажи'],
    ['Доп. комиссия WB', 0.0175, 'Прибавляется к категорийной комиссии'],
    ['% выкупа', 0.9, 'Справочно'],
    ['Брак/потери', 0.01, 'Доля от закупки'],
    ['Логистика: 1-й литр, ₽', 46, 'Тариф WB'],
    ['Логистика: доп. литр, ₽', 14, 'За литр сверх 1'],
    ['Наценка обратной логистики', 0.0454, 'К базовой доставке'],
    ['Упаковка по умолчанию, ₽', 65, 'Если колонка «Упаковка» пуста'],
    ['Коэфф. склада по умолчанию', 2.2, 'Если колонка «Коэфф.» пуста'],
  ];
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange('B2:B5').setNumberFormat('0.00%');
  sheet.getRange('B8').setNumberFormat('0.00%');
  sheet.getRange('B6:B7').setNumberFormat('0');
  sheet.getRange('B9:B10').setNumberFormat('0.00');
  sheet.setColumnWidths(1, 3, [220, 100, 340]);
}

function setupPurchaseSheet_(ss) {
  const sheet = ss.getSheetByName('_Цены_закупки') || ss.insertSheet('_Цены_закупки');
  sheet.clear();
  sheet.getRange('A1:B1').setValues([['Артикул продавца', 'Цена закупки']]);
  sheet.setFrozenRows(1);
}

function setupCommissionSheet_(ss) {
  const sheet = ss.getSheetByName('_Комиссия_ВБ') || ss.insertSheet('_Комиссия_ВБ');
  sheet.clear();
  sheet.getRange('A1:C1').setValues([['Артикул продавца', 'Комиссия FBO', 'Комиссия FBS']]);
  sheet.getRange('B2:C').setNumberFormat('0.00%');
  sheet.setFrozenRows(1);
}

function setupMainSheet_(ss) {
  let sheet = ss.getSheetByName('Юнитка');
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet('Юнитка', 0);

  const headers = [
    '№', 'Артикул ВБ', 'Артикул продавца', 'Бренд', 'Название',
    'Остаток FBO', 'Остаток FBS', 'Остаток поставщика', 'Комментарий', 'Заказы 7д',
    'Цена закупки', 'Цена продажи', 'Цена базовая', '% скидки',
    'Цена продажи кальк.', 'Прибыль FBO кальк.', 'Рентаб. FBO кальк.%',
    'Прибыль FBS кальк.', 'Рентаб. FBS кальк.%',
    'Наша цена на ВБ', 'СПП',
    '% Выкупа', 'Длина', 'Ширина', 'Высота', 'Объём', 'Коэфф. склада',
    'Доставка базовая', 'Доставка с возвратом',
    'Налог УСН %', 'Налог ₽', 'Доп. комиссия %',
    'Комиссия FBO кат.%', 'Комиссия FBO итог%', 'Комиссия FBO ₽',
    'Комиссия FBS кат.%', 'Комиссия FBS итог%', 'Комиссия FBS ₽',
    'Упаковка', 'Хранение', 'Брак %', 'Брак ₽',
    'Прибыль FBO', 'Маржа FBO %', 'Рентаб. FBO %',
    'Прибыль FBS', 'Маржа FBS %', 'Рентаб. FBS %',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);
}

function importSeedData_(ss) {
  if (typeof SEED_PURCHASES === 'undefined') return;
  const purchaseSheet = ss.getSheetByName('_Цены_закупки');
  if (SEED_PURCHASES.length) {
    purchaseSheet.getRange(2, 1, SEED_PURCHASES.length, 2).setValues(SEED_PURCHASES);
  }
  const commSheet = ss.getSheetByName('_Комиссия_ВБ');
  if (SEED_COMMISSIONS.length) {
    commSheet.getRange(2, 1, SEED_COMMISSIONS.length, 3).setValues(SEED_COMMISSIONS);
  }
}

/**
 * Колонки листа «Юнитка» (A=1):
 * K закупка, L продажа, M базовая, N скидка, O–S калькулятор,
 * T наша цена, U СПП, V выкуп, W–Y габариты, Z объём, AA коэфф.,
 * AB баз. дост., AC дост.+возврат, AD налог%, AE налог₽, AF доп.ком.%,
 * AG–AI FBO, AJ–AL FBS, AM упаковка, AN хранение, AO брак%, AP брак₽,
 * AQ–AS FBO итог, AT–AV FBS итог
 */
function applyFormulas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Юнитка');
  if (!sheet) throw new Error('Лист «Юнитка» не найден');

  const startRow = 2;
  const lastRow = 2002;
  const formulas = buildFormulaMap_(startRow);

  Object.keys(formulas).forEach((col) => {
    const colNum = Number(col);
    const letter = columnToLetter_(colNum);
    const source = sheet.getRange(`${letter}${startRow}`);
    source.setFormula(formulas[colNum]);
    source.copyTo(
      sheet.getRange(`${letter}${startRow}:${letter}${lastRow}`),
      SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
      false
    );
  });

  formatMainSheet_(sheet, lastRow);
}

function buildFormulaMap_(r) {
  const pack = `IF(AM${r}>0,AM${r},'_Настройки'!$B$9)`;
  const coeff = `IF(AA${r}>0,AA${r},'_Настройки'!$B$10)`;
  const subRate = `IF(Z${r}<=0.2,23,IF(Z${r}<=0.4,26,IF(Z${r}<=0.6,29,IF(Z${r}<=0.8,30,32))))`;

  return {
    1: `=ROW()-1`,
    11: `=IFERROR(XLOOKUP(C${r},'_Цены_закупки'!A:A,'_Цены_закупки'!B:B),"")`,
    14: `=IF(AND(M${r}>0,L${r}>0),1-L${r}/M${r},"")`,
    15: `=IF(OR(Q${r}="",K${r}=0),"",(K${r}+${pack}+AP${r}+AC${r}+Q${r}*K${r})/(1-AH${r}-AD${r}))`,
    16: `=IF(O${r}="","",O${r}-K${r}-O${r}*AH${r}-O${r}*AD${r}-${pack}-AP${r}-AC${r})`,
    17: `=IF(AND(O${r}>0,K${r}>0),P${r}/K${r},"")`,
    18: `=IF(O${r}="","",O${r}-K${r}-O${r}*AK${r}-O${r}*AD${r}-${pack}-AP${r}-AC${r})`,
    19: `=IF(AND(O${r}>0,K${r}>0),R${r}/K${r},"")`,
    21: `=IF(AND(L${r}>0,T${r}>0),1-T${r}/L${r},"")`,
    22: `='_Настройки'!$B$4`,
    26: `=IF(AND(W${r}>0,X${r}>0,Y${r}>0),W${r}*X${r}*Y${r}/1000,"")`,
    28: `=IF(Z${r}>1,('_Настройки'!$B$6+MAX(0,Z${r}-1)*'_Настройки'!$B$7)*${coeff},(${subRate})*${coeff})`,
    29: `=AB${r}*(1+'_Настройки'!$B$8)`,
    30: `='_Настройки'!$B$2`,
    31: `=L${r}*AD${r}`,
    32: `='_Настройки'!$B$3`,
    33: `=IFERROR(XLOOKUP(C${r},'_Комиссия_ВБ'!A:A,'_Комиссия_ВБ'!B:B),0.245)`,
    34: `=AG${r}+AF${r}`,
    35: `=L${r}*AH${r}`,
    36: `=IFERROR(XLOOKUP(C${r},'_Комиссия_ВБ'!A:A,'_Комиссия_ВБ'!C:C),0.28)`,
    37: `=AJ${r}+AF${r}`,
    38: `=L${r}*AK${r}`,
    41: `='_Настройки'!$B$5`,
    42: `=IF(K${r}>0,K${r}*AO${r},0)`,
    43: `=L${r}-K${r}-AI${r}-AE${r}-${pack}-AP${r}-AC${r}`,
    44: `=IF(L${r}>0,AQ${r}/L${r},"")`,
    45: `=IF(K${r}>0,AQ${r}/K${r},"")`,
    46: `=L${r}-K${r}-AL${r}-AE${r}-${pack}-AP${r}-AC${r}`,
    47: `=IF(L${r}>0,AT${r}/L${r},"")`,
    48: `=IF(K${r}>0,AT${r}/K${r},"")`,
  };
}

function formatMainSheet_(sheet, lastRow) {
  const moneyCols = [11, 12, 13, 15, 16, 18, 20, 28, 29, 31, 35, 38, 39, 42, 43, 46];
  const pctCols = [14, 17, 19, 21, 22, 30, 32, 33, 34, 36, 37, 41, 44, 45, 47, 48];
  moneyCols.forEach((c) => sheet.getRange(2, c, lastRow - 1, 1).setNumberFormat('#,##0.00'));
  pctCols.forEach((c) => sheet.getRange(2, c, lastRow - 1, 1).setNumberFormat('0.00%'));
  sheet.getRange(2, 26, lastRow - 1, 1).setNumberFormat('0.00');
}

function columnToLetter_(column) {
  let temp = '';
  let letter = column;
  while (letter > 0) {
    const mod = (letter - 1) % 26;
    temp = String.fromCharCode(65 + mod) + temp;
    letter = Math.floor((letter - mod) / 26);
  }
  return temp;
}
