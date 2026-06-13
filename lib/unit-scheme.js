export const SCHEME_FBS = 'fbs';
export const SCHEME_FBO = 'fbo';
export const DEFAULT_SCHEME = SCHEME_FBS;

export function resolveScheme(settings = {}) {
  return settings.primaryScheme === SCHEME_FBO ? SCHEME_FBO : SCHEME_FBS;
}

export function schemeLabel(scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? 'FBO' : 'FBS';
}

export function primaryProfit(row, scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? row.profitFbo : row.profitFbs;
}

export function primaryMargin(row, scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? row.marginFbo : row.marginFbs;
}

export function primaryLogistics(row, scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? row.logisticsFbo : row.logisticsFbs;
}

export function primaryCommissionRub(row, scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? row.fboCommissionRub : row.fbsCommissionRub;
}

export function primaryLogisticsKey(scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? 'logisticsFbo' : 'logisticsFbs';
}

export function primaryMarginKey(scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? 'marginFbo' : 'marginFbs';
}

export function primaryProfitKey(scheme = DEFAULT_SCHEME) {
  return scheme === SCHEME_FBO ? 'profitFbo' : 'profitFbs';
}
