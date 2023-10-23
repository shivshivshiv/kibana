/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineCypressConfig } from '@kbn/cypress-config';
import { esArchiver } from './support/es_archiver';
const registerReportPortalPlugin = require('@reportportal/agent-js-cypress/lib/plugin');

// eslint-disable-next-line import/no-default-export
export default defineCypressConfig({
  reporter: '../../../node_modules/@reportportal/agent-js-cypress',
  reporterOptions: {
    endpoint: 'https://35.226.254.46/api/v1',
    apiKey: process.env.RP_API_KEY,
    launch: 'security_solution_QA_cypress',
    project: 'test-development',
    description: 'The security solution cypress tests for QA quality gate',
    launchId: process.env.LAUNCH_ID,
    launchUuidPrint: true,
    skippedIssue: false,
    autoMerge: true,
    parallel: true,
    attributes: [],
  },
  defaultCommandTimeout: 150000,
  env: {
    grepFilterSpecs: true,
    grepOmitFiltered: true,
    grepTags: '@serverless --@brokenInServerless --@skipInServerless',
  },
  execTimeout: 150000,
  pageLoadTimeout: 150000,
  numTestsKeptInMemory: 0,
  retries: {
    runMode: 1,
  },
  screenshotsFolder: '../../../target/kibana-security-solution/cypress/screenshots',
  trashAssetsBeforeRuns: false,
  video: false,
  videosFolder: '../../../../target/kibana-security-solution/cypress/videos',
  viewportHeight: 946,
  viewportWidth: 1680,
  e2e: {
    baseUrl: 'http://localhost:5601',
    experimentalCspAllowList: ['default-src', 'script-src', 'script-src-elem'],
    experimentalMemoryManagement: true,
    specPattern: './cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      esArchiver(on, config);
      registerReportPortalPlugin(on, config);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@cypress/grep/src/plugin')(config);
      return config;
    },
  },
});
