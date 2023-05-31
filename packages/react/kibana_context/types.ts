/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

// To avoid a circular dependency with the deprecation of `CoreThemeProvider`,
// we need to define the theme type here.
//
// TODO: clintandrewhall - remove this file once `CoreThemeProvider` is removed
export interface Theme {
  /** is dark mode enabled or not */
  readonly darkMode: boolean;
}
