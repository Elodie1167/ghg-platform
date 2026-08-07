import type { Rule } from './types';
import { govCsrGhgMismatchRule } from './rules/govCsrGhgMismatch';
import {
  logicRecExceedRule, logicBiomassCo2Rule, logicNegativeTotalRule, logicMissingFactorRule,
} from './rules/logicRules';
import { trendMonthSpikeRule, trendYoyChangeRule, trendZeroAfterActiveRule } from './rules/trendRules';
import { dataMissingMonthRule } from './rules/dataMissingMonth';
import { govDuplicateEntryRule } from './rules/govDuplicateEntry';

export const RULES: Rule[] = [
  logicRecExceedRule,
  logicBiomassCo2Rule,
  logicNegativeTotalRule,
  logicMissingFactorRule,
  govCsrGhgMismatchRule,
  dataMissingMonthRule,
  trendMonthSpikeRule,
  trendYoyChangeRule,
  trendZeroAfterActiveRule,
  govDuplicateEntryRule,
];
