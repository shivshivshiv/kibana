/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import {
  KibanaThemeProvider as ThemeProvider,
  wrapWithTheme as withTheme,
} from '@kbn/react-kibana-context';

export type { KibanaThemeProviderProps } from '@kbn/react-kibana-context';
export type { UseEuiTheme as EuiTheme } from '@elastic/eui';

/**
 * @deprecated use `KibanaThemeProvider` from `@kbn/react-kibana-context
 */
export const KibanaThemeProvider = ThemeProvider;

/**
 * @deprecated use `wrapWithTheme` from `@kbn/react-kibana-context
 */
export const wrapWithTheme = withTheme;
