/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';

import { BadRequestError } from '@kbn/securitysolution-es-utils';
import { validate, validateNonExact } from '@kbn/securitysolution-io-ts-utils';
import { ruleTypeMappings } from '@kbn/securitysolution-rules';
import type { ResolvedSanitizedRule, SanitizedRule } from '@kbn/alerting-plugin/common';

import {
  DEFAULT_INDICATOR_SOURCE_PATH,
  DEFAULT_MAX_SIGNALS,
  SERVER_APP_ID,
} from '../../../../../common/constants';

import type { PatchRuleRequestBody } from '../../../../../common/api/detection_engine/rule_management';
import type {
  RelatedIntegrationArray,
  RequiredFieldArray,
  SetupGuide,
  RuleCreateProps,
  TypeSpecificCreateProps,
  TypeSpecificResponse,
} from '../../../../../common/api/detection_engine/model/rule_schema';
import {
  EqlPatchParams,
  EsqlPatchParams,
  MachineLearningPatchParams,
  NewTermsPatchParams,
  QueryPatchParams,
  SavedQueryPatchParams,
  ThreatMatchPatchParams,
  ThresholdPatchParams,
  RuleResponse,
} from '../../../../../common/api/detection_engine/model/rule_schema';

import {
  transformAlertToRuleAction,
  transformAlertToRuleResponseAction,
  transformRuleToAlertAction,
  transformRuleToAlertResponseAction,
} from '../../../../../common/detection_engine/transform_actions';

import {
  normalizeMachineLearningJobIds,
  normalizeThresholdObject,
} from '../../../../../common/detection_engine/utils';

import { assertUnreachable } from '../../../../../common/utility_types';

import type {
  InternalRuleCreate,
  RuleParams,
  TypeSpecificRuleParams,
  BaseRuleParams,
  EqlRuleParams,
  EqlSpecificRuleParams,
  EsqlRuleParams,
  EsqlSpecificRuleParams,
  ThreatRuleParams,
  ThreatSpecificRuleParams,
  QueryRuleParams,
  QuerySpecificRuleParams,
  SavedQuerySpecificRuleParams,
  SavedQueryRuleParams,
  ThresholdRuleParams,
  ThresholdSpecificRuleParams,
  MachineLearningRuleParams,
  MachineLearningSpecificRuleParams,
  InternalRuleUpdate,
  NewTermsRuleParams,
  NewTermsSpecificRuleParams,
} from '../../rule_schema';
import { transformFromAlertThrottle, transformToActionFrequency } from './rule_actions';
import {
  convertAlertSuppressionToCamel,
  convertAlertSuppressionToSnake,
  migrateLegacyInvestigationFields,
} from '../utils/utils';
import { createRuleExecutionSummary } from '../../rule_monitoring';
import type { PrebuiltRuleAsset } from '../../prebuilt_rules';

const DEFAULT_FROM = 'now-6m' as const;
const DEFAULT_TO = 'now' as const;
const DEFAULT_INTERVAL = '5m' as const;

// These functions provide conversions from the request API schema to the internal rule schema and from the internal rule schema
// to the response API schema. This provides static type-check assurances that the internal schema is in sync with the API schema for
// required and default-able fields. However, it is still possible to add an optional field to the API schema
// without causing a type-check error here.

// Converts params from the snake case API format to the internal camel case format AND applies default values where needed.
// Notice that params.language is possibly undefined for most rule types in the API but we default it to kuery to match
// the legacy API behavior
export const typeSpecificSnakeToCamel = (
  params: TypeSpecificCreateProps
): TypeSpecificRuleParams => {
  switch (params.type) {
    case 'eql': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        dataViewId: params.data_view_id,
        query: params.query,
        filters: params.filters,
        timestampField: params.timestamp_field,
        eventCategoryOverride: params.event_category_override,
        tiebreakerField: params.tiebreaker_field,
      };
    }
    case 'esql': {
      return {
        type: params.type,
        language: params.language,
        query: params.query,
      };
    }
    case 'threat_match': {
      return {
        type: params.type,
        language: params.language ?? 'kuery',
        index: params.index,
        dataViewId: params.data_view_id,
        query: params.query,
        filters: params.filters,
        savedId: params.saved_id,
        threatFilters: params.threat_filters,
        threatQuery: params.threat_query,
        threatMapping: params.threat_mapping,
        threatLanguage: params.threat_language,
        threatIndex: params.threat_index,
        threatIndicatorPath: params.threat_indicator_path ?? DEFAULT_INDICATOR_SOURCE_PATH,
        concurrentSearches: params.concurrent_searches,
        itemsPerSearch: params.items_per_search,
      };
    }
    case 'query': {
      return {
        type: params.type,
        language: params.language ?? 'kuery',
        index: params.index,
        dataViewId: params.data_view_id,
        query: params.query ?? '',
        filters: params.filters,
        savedId: params.saved_id,
        responseActions: params.response_actions?.map(transformRuleToAlertResponseAction),
        alertSuppression: convertAlertSuppressionToCamel(params.alert_suppression),
      };
    }
    case 'saved_query': {
      return {
        type: params.type,
        language: params.language ?? 'kuery',
        index: params.index,
        query: params.query,
        filters: params.filters,
        savedId: params.saved_id,
        dataViewId: params.data_view_id,
        responseActions: params.response_actions?.map(transformRuleToAlertResponseAction),
        alertSuppression: convertAlertSuppressionToCamel(params.alert_suppression),
      };
    }
    case 'threshold': {
      return {
        type: params.type,
        language: params.language ?? 'kuery',
        index: params.index,
        dataViewId: params.data_view_id,
        query: params.query,
        filters: params.filters,
        savedId: params.saved_id,
        threshold: normalizeThresholdObject(params.threshold),
      };
    }
    case 'machine_learning': {
      return {
        type: params.type,
        anomalyThreshold: params.anomaly_threshold,
        machineLearningJobId: normalizeMachineLearningJobIds(params.machine_learning_job_id),
      };
    }
    case 'new_terms': {
      return {
        type: params.type,
        query: params.query,
        newTermsFields: params.new_terms_fields,
        historyWindowStart: params.history_window_start,
        index: params.index,
        filters: params.filters,
        language: params.language ?? 'kuery',
        dataViewId: params.data_view_id,
      };
    }
    default: {
      return assertUnreachable(params);
    }
  }
};

const patchEqlParams = (
  params: EqlPatchParams,
  existingRule: EqlRuleParams
): EqlSpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    timestampField: params.timestamp_field ?? existingRule.timestampField,
    eventCategoryOverride: params.event_category_override ?? existingRule.eventCategoryOverride,
    tiebreakerField: params.tiebreaker_field ?? existingRule.tiebreakerField,
  };
};

const patchEsqlParams = (
  params: EsqlPatchParams,
  existingRule: EsqlRuleParams
): EsqlSpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    query: params.query ?? existingRule.query,
  };
};

const patchThreatMatchParams = (
  params: ThreatMatchPatchParams,
  existingRule: ThreatRuleParams
): ThreatSpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    savedId: params.saved_id ?? existingRule.savedId,
    threatFilters: params.threat_filters ?? existingRule.threatFilters,
    threatQuery: params.threat_query ?? existingRule.threatQuery,
    threatMapping: params.threat_mapping ?? existingRule.threatMapping,
    threatLanguage: params.threat_language ?? existingRule.threatLanguage,
    threatIndex: params.threat_index ?? existingRule.threatIndex,
    threatIndicatorPath: params.threat_indicator_path ?? existingRule.threatIndicatorPath,
    concurrentSearches: params.concurrent_searches ?? existingRule.concurrentSearches,
    itemsPerSearch: params.items_per_search ?? existingRule.itemsPerSearch,
  };
};

const patchQueryParams = (
  params: QueryPatchParams,
  existingRule: QueryRuleParams
): QuerySpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    savedId: params.saved_id ?? existingRule.savedId,
    responseActions:
      params.response_actions?.map(transformRuleToAlertResponseAction) ??
      existingRule.responseActions,
    alertSuppression:
      convertAlertSuppressionToCamel(params.alert_suppression) ?? existingRule.alertSuppression,
  };
};

const patchSavedQueryParams = (
  params: SavedQueryPatchParams,
  existingRule: SavedQueryRuleParams
): SavedQuerySpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    savedId: params.saved_id ?? existingRule.savedId,
    responseActions:
      params.response_actions?.map(transformRuleToAlertResponseAction) ??
      existingRule.responseActions,
    alertSuppression:
      convertAlertSuppressionToCamel(params.alert_suppression) ?? existingRule.alertSuppression,
  };
};

const patchThresholdParams = (
  params: ThresholdPatchParams,
  existingRule: ThresholdRuleParams
): ThresholdSpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    savedId: params.saved_id ?? existingRule.savedId,
    threshold: params.threshold
      ? normalizeThresholdObject(params.threshold)
      : existingRule.threshold,
  };
};

const patchMachineLearningParams = (
  params: MachineLearningPatchParams,
  existingRule: MachineLearningRuleParams
): MachineLearningSpecificRuleParams => {
  return {
    type: existingRule.type,
    anomalyThreshold: params.anomaly_threshold ?? existingRule.anomalyThreshold,
    machineLearningJobId: params.machine_learning_job_id
      ? normalizeMachineLearningJobIds(params.machine_learning_job_id)
      : existingRule.machineLearningJobId,
  };
};

const patchNewTermsParams = (
  params: NewTermsPatchParams,
  existingRule: NewTermsRuleParams
): NewTermsSpecificRuleParams => {
  return {
    type: existingRule.type,
    language: params.language ?? existingRule.language,
    index: params.index ?? existingRule.index,
    dataViewId: params.data_view_id ?? existingRule.dataViewId,
    query: params.query ?? existingRule.query,
    filters: params.filters ?? existingRule.filters,
    newTermsFields: params.new_terms_fields ?? existingRule.newTermsFields,
    historyWindowStart: params.history_window_start ?? existingRule.historyWindowStart,
  };
};

const parseValidationError = (error: string | null): BadRequestError => {
  if (error != null) {
    return new BadRequestError(error);
  } else {
    return new BadRequestError('unknown validation error');
  }
};

export const patchTypeSpecificSnakeToCamel = (
  params: PatchRuleRequestBody,
  existingRule: RuleParams
): TypeSpecificRuleParams => {
  // Here we do the validation of patch params by rule type to ensure that the fields that are
  // passed in to patch are of the correct type, e.g. `query` is a string. Since the combined patch schema
  // is a union of types where everything is optional, it's hard to do the validation before we know the rule type -
  // a patch request that defines `event_category_override` as a number would not be assignable to the EQL patch schema,
  // but would be assignable to the other rule types since they don't specify `event_category_override`.
  switch (existingRule.type) {
    case 'eql': {
      const [validated, error] = validateNonExact(params, EqlPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchEqlParams(validated, existingRule);
    }
    case 'esql': {
      const [validated, error] = validateNonExact(params, EsqlPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchEsqlParams(validated, existingRule);
    }
    case 'threat_match': {
      const [validated, error] = validateNonExact(params, ThreatMatchPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchThreatMatchParams(validated, existingRule);
    }
    case 'query': {
      const [validated, error] = validateNonExact(params, QueryPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchQueryParams(validated, existingRule);
    }
    case 'saved_query': {
      const [validated, error] = validateNonExact(params, SavedQueryPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchSavedQueryParams(validated, existingRule);
    }
    case 'threshold': {
      const [validated, error] = validateNonExact(params, ThresholdPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchThresholdParams(validated, existingRule);
    }
    case 'machine_learning': {
      const [validated, error] = validateNonExact(params, MachineLearningPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchMachineLearningParams(validated, existingRule);
    }
    case 'new_terms': {
      const [validated, error] = validateNonExact(params, NewTermsPatchParams);
      if (validated == null) {
        throw parseValidationError(error);
      }
      return patchNewTermsParams(validated, existingRule);
    }
    default: {
      return assertUnreachable(existingRule);
    }
  }
};

// eslint-disable-next-line complexity
export const convertPatchAPIToInternalSchema = (
  nextParams: PatchRuleRequestBody & {
    related_integrations?: RelatedIntegrationArray;
    required_fields?: RequiredFieldArray;
    setup?: SetupGuide;
  },
  existingRule: SanitizedRule<RuleParams>
): InternalRuleUpdate => {
  const typeSpecificParams = patchTypeSpecificSnakeToCamel(nextParams, existingRule.params);
  const existingParams = existingRule.params;

  const alertActions = nextParams.actions?.map(transformRuleToAlertAction) ?? existingRule.actions;
  const throttle = nextParams.throttle ?? transformFromAlertThrottle(existingRule);
  const actions = transformToActionFrequency(alertActions, throttle);

  return {
    name: nextParams.name ?? existingRule.name,
    tags: nextParams.tags ?? existingRule.tags,
    params: {
      author: nextParams.author ?? existingParams.author,
      buildingBlockType: nextParams.building_block_type ?? existingParams.buildingBlockType,
      description: nextParams.description ?? existingParams.description,
      ruleId: existingParams.ruleId,
      falsePositives: nextParams.false_positives ?? existingParams.falsePositives,
      investigationFields: nextParams.investigation_fields ?? existingParams.investigationFields,
      from: nextParams.from ?? existingParams.from,
      immutable: existingParams.immutable,
      license: nextParams.license ?? existingParams.license,
      outputIndex: nextParams.output_index ?? existingParams.outputIndex,
      timelineId: nextParams.timeline_id ?? existingParams.timelineId,
      timelineTitle: nextParams.timeline_title ?? existingParams.timelineTitle,
      meta: nextParams.meta ?? existingParams.meta,
      maxSignals: nextParams.max_signals ?? existingParams.maxSignals,
      relatedIntegrations: nextParams.related_integrations ?? existingParams.relatedIntegrations,
      requiredFields: nextParams.required_fields ?? existingParams.requiredFields,
      riskScore: nextParams.risk_score ?? existingParams.riskScore,
      riskScoreMapping: nextParams.risk_score_mapping ?? existingParams.riskScoreMapping,
      ruleNameOverride: nextParams.rule_name_override ?? existingParams.ruleNameOverride,
      setup: nextParams.setup ?? existingParams.setup,
      severity: nextParams.severity ?? existingParams.severity,
      severityMapping: nextParams.severity_mapping ?? existingParams.severityMapping,
      threat: nextParams.threat ?? existingParams.threat,
      timestampOverride: nextParams.timestamp_override ?? existingParams.timestampOverride,
      timestampOverrideFallbackDisabled:
        nextParams.timestamp_override_fallback_disabled ??
        existingParams.timestampOverrideFallbackDisabled,
      to: nextParams.to ?? existingParams.to,
      references: nextParams.references ?? existingParams.references,
      namespace: nextParams.namespace ?? existingParams.namespace,
      note: nextParams.note ?? existingParams.note,
      version: nextParams.version ?? existingParams.version,
      exceptionsList: nextParams.exceptions_list ?? existingParams.exceptionsList,
      ...typeSpecificParams,
    },
    schedule: { interval: nextParams.interval ?? existingRule.schedule.interval },
    actions,
  };
};

// eslint-disable-next-line complexity
export const convertCreateAPIToInternalSchema = (
  input: RuleCreateProps & {
    related_integrations?: RelatedIntegrationArray;
    required_fields?: RequiredFieldArray;
    setup?: SetupGuide;
  },
  immutable = false,
  defaultEnabled = true
): InternalRuleCreate => {
  const typeSpecificParams = typeSpecificSnakeToCamel(input);
  const newRuleId = input.rule_id ?? uuidv4();

  const alertActions = input.actions?.map(transformRuleToAlertAction) ?? [];
  const actions = transformToActionFrequency(alertActions, input.throttle);

  return {
    name: input.name,
    tags: input.tags ?? [],
    alertTypeId: ruleTypeMappings[input.type],
    consumer: SERVER_APP_ID,
    params: {
      author: input.author ?? [],
      buildingBlockType: input.building_block_type,
      description: input.description,
      ruleId: newRuleId,
      falsePositives: input.false_positives ?? [],
      investigationFields: input.investigation_fields,
      from: input.from ?? DEFAULT_FROM,
      immutable,
      license: input.license,
      outputIndex: input.output_index ?? '',
      timelineId: input.timeline_id,
      timelineTitle: input.timeline_title,
      meta: input.meta,
      maxSignals: input.max_signals ?? DEFAULT_MAX_SIGNALS,
      riskScore: input.risk_score,
      riskScoreMapping: input.risk_score_mapping ?? [],
      ruleNameOverride: input.rule_name_override,
      severity: input.severity,
      severityMapping: input.severity_mapping ?? [],
      threat: input.threat ?? [],
      timestampOverride: input.timestamp_override,
      timestampOverrideFallbackDisabled: input.timestamp_override_fallback_disabled,
      to: input.to ?? DEFAULT_TO,
      references: input.references ?? [],
      namespace: input.namespace,
      note: input.note,
      version: input.version ?? 1,
      exceptionsList: input.exceptions_list ?? [],
      relatedIntegrations: input.related_integrations ?? [],
      requiredFields: input.required_fields ?? [],
      setup: input.setup ?? '',
      ...typeSpecificParams,
    },
    schedule: { interval: input.interval ?? '5m' },
    enabled: input.enabled ?? defaultEnabled,
    actions,
  };
};

// Converts the internal rule data structure to the response API schema
export const typeSpecificCamelToSnake = (params: TypeSpecificRuleParams): TypeSpecificResponse => {
  switch (params.type) {
    case 'eql': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        data_view_id: params.dataViewId,
        query: params.query,
        filters: params.filters,
        timestamp_field: params.timestampField,
        event_category_override: params.eventCategoryOverride,
        tiebreaker_field: params.tiebreakerField,
      };
    }
    case 'esql': {
      return {
        type: params.type,
        language: params.language,
        query: params.query,
      };
    }
    case 'threat_match': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        data_view_id: params.dataViewId,
        query: params.query,
        filters: params.filters,
        saved_id: params.savedId,
        threat_filters: params.threatFilters,
        threat_query: params.threatQuery,
        threat_mapping: params.threatMapping,
        threat_language: params.threatLanguage,
        threat_index: params.threatIndex,
        threat_indicator_path: params.threatIndicatorPath,
        concurrent_searches: params.concurrentSearches,
        items_per_search: params.itemsPerSearch,
      };
    }
    case 'query': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        data_view_id: params.dataViewId,
        query: params.query,
        filters: params.filters,
        saved_id: params.savedId,
        response_actions: params.responseActions?.map(transformAlertToRuleResponseAction),
        alert_suppression: convertAlertSuppressionToSnake(params.alertSuppression),
      };
    }
    case 'saved_query': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        query: params.query,
        filters: params.filters,
        saved_id: params.savedId,
        data_view_id: params.dataViewId,
        response_actions: params.responseActions?.map(transformAlertToRuleResponseAction),
        alert_suppression: convertAlertSuppressionToSnake(params.alertSuppression),
      };
    }
    case 'threshold': {
      return {
        type: params.type,
        language: params.language,
        index: params.index,
        data_view_id: params.dataViewId,
        query: params.query,
        filters: params.filters,
        saved_id: params.savedId,
        threshold: params.threshold,
      };
    }
    case 'machine_learning': {
      return {
        type: params.type,
        anomaly_threshold: params.anomalyThreshold,
        machine_learning_job_id: params.machineLearningJobId,
      };
    }
    case 'new_terms': {
      return {
        type: params.type,
        query: params.query,
        new_terms_fields: params.newTermsFields,
        history_window_start: params.historyWindowStart,
        index: params.index,
        filters: params.filters,
        language: params.language,
        data_view_id: params.dataViewId,
      };
    }
    default: {
      return assertUnreachable(params);
    }
  }
};

// TODO: separate out security solution defined common params from Alerting framework common params
// so we can explicitly specify the return type of this function
export const commonParamsCamelToSnake = (params: BaseRuleParams) => {
  return {
    description: params.description,
    risk_score: params.riskScore,
    severity: params.severity,
    building_block_type: params.buildingBlockType,
    namespace: params.namespace,
    note: params.note,
    license: params.license,
    output_index: params.outputIndex,
    timeline_id: params.timelineId,
    timeline_title: params.timelineTitle,
    meta: params.meta,
    rule_name_override: params.ruleNameOverride,
    timestamp_override: params.timestampOverride,
    timestamp_override_fallback_disabled: params.timestampOverrideFallbackDisabled,
    investigation_fields: migrateLegacyInvestigationFields(params.investigationFields),
    author: params.author,
    false_positives: params.falsePositives,
    from: params.from,
    rule_id: params.ruleId,
    max_signals: params.maxSignals,
    risk_score_mapping: params.riskScoreMapping,
    severity_mapping: params.severityMapping,
    threat: params.threat,
    to: params.to,
    references: params.references,
    version: params.version,
    exceptions_list: params.exceptionsList,
    immutable: params.immutable,
    related_integrations: params.relatedIntegrations ?? [],
    required_fields: params.requiredFields ?? [],
    setup: params.setup ?? '',
  };
};

export const internalRuleToAPIResponse = (
  rule: SanitizedRule<RuleParams> | ResolvedSanitizedRule<RuleParams>
): RuleResponse => {
  const executionSummary = createRuleExecutionSummary(rule);

  const isResolvedRule = (obj: unknown): obj is ResolvedSanitizedRule<RuleParams> =>
    (obj as ResolvedSanitizedRule<RuleParams>).outcome != null;

  const alertActions = rule.actions.map(transformAlertToRuleAction);
  const throttle = transformFromAlertThrottle(rule);
  const actions = transformToActionFrequency(alertActions, throttle);

  return {
    // saved object properties
    outcome: isResolvedRule(rule) ? rule.outcome : undefined,
    alias_target_id: isResolvedRule(rule) ? rule.alias_target_id : undefined,
    alias_purpose: isResolvedRule(rule) ? rule.alias_purpose : undefined,
    // Alerting framework params
    id: rule.id,
    updated_at: rule.updatedAt.toISOString(),
    updated_by: rule.updatedBy ?? 'elastic',
    created_at: rule.createdAt.toISOString(),
    created_by: rule.createdBy ?? 'elastic',
    name: rule.name,
    tags: rule.tags,
    interval: rule.schedule.interval,
    enabled: rule.enabled,
    revision: rule.revision,
    // Security solution shared rule params
    ...commonParamsCamelToSnake(rule.params),
    // Type specific security solution rule params
    ...typeSpecificCamelToSnake(rule.params),
    // Actions
    throttle: undefined,
    actions,
    // Execution summary
    execution_summary: executionSummary ?? undefined,
  };
};

export const convertPrebuiltRuleAssetToRuleResponse = (
  prebuiltRuleAsset: PrebuiltRuleAsset
): RuleResponse => {
  const prebuiltRuleAssetDefaults = {
    enabled: false,
    risk_score_mapping: [],
    severity_mapping: [],
    interval: DEFAULT_INTERVAL,
    to: DEFAULT_TO,
    from: DEFAULT_FROM,
    exceptions_list: [],
    false_positives: [],
    max_signals: DEFAULT_MAX_SIGNALS,
    actions: [],
    related_integrations: [],
    required_fields: [],
    setup: '',
    references: [],
    threat: [],
    tags: [],
    author: [],
  };

  const ruleResponseSpecificFields = {
    id: uuidv4(),
    updated_at: new Date(0).toISOString(),
    updated_by: '',
    created_at: new Date(0).toISOString(),
    created_by: '',
    immutable: true,
    revision: 1,
  };

  const [rule, error] = validate(
    { ...prebuiltRuleAssetDefaults, ...prebuiltRuleAsset, ...ruleResponseSpecificFields },
    RuleResponse
  );

  if (!rule) {
    throw new Error(error);
  }

  return rule;
};
