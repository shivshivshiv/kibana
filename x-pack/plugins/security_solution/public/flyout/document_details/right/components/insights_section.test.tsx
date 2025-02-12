/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { RightPanelContext } from '../context';
import { INSIGHTS_HEADER_TEST_ID } from './test_ids';
import { TestProviders } from '../../../../common/mock';
import { mockGetFieldsData } from '../../shared/mocks/mock_get_fields_data';
import { mockDataFormattedForFieldBrowser } from '../../shared/mocks/mock_data_formatted_for_field_browser';
import { InsightsSection } from './insights_section';
import { useAlertPrevalence } from '../../../../common/containers/alerts/use_alert_prevalence';

jest.mock('../../../../common/containers/alerts/use_alert_prevalence');

const mockDispatch = jest.fn();
jest.mock('react-redux', () => {
  const original = jest.requireActual('react-redux');

  return {
    ...original,
    useDispatch: () => mockDispatch,
  };
});

jest.mock('react-router-dom', () => {
  const original = jest.requireActual('react-router-dom');
  return {
    ...original,
    useLocation: () => jest.fn().mockReturnValue({ pathname: '/overview' }),
  };
});
(useAlertPrevalence as jest.Mock).mockReturnValue({
  loading: false,
  error: false,
  count: 0,
  alertIds: [],
});

const renderInsightsSection = (contextValue: RightPanelContext, expanded: boolean) =>
  render(
    <TestProviders>
      <RightPanelContext.Provider value={contextValue}>
        <InsightsSection expanded={expanded} />
      </RightPanelContext.Provider>
    </TestProviders>
  );

describe('<InsightsSection />', () => {
  it('should render insights component', () => {
    const contextValue = {
      eventId: 'some_Id',
      getFieldsData: mockGetFieldsData,
    } as unknown as RightPanelContext;

    const wrapper = renderInsightsSection(contextValue, false);

    expect(wrapper.getByTestId(INSIGHTS_HEADER_TEST_ID)).toBeInTheDocument();
    expect(wrapper.getAllByRole('button')[0]).toHaveAttribute('aria-expanded', 'false');
    expect(wrapper.getAllByRole('button')[0]).not.toHaveAttribute('disabled');
  });

  it('should render insights component as expanded when expanded is true', () => {
    const contextValue = {
      eventId: 'some_Id',
      dataFormattedForFieldBrowser: mockDataFormattedForFieldBrowser,
      getFieldsData: mockGetFieldsData,
    } as unknown as RightPanelContext;

    const wrapper = renderInsightsSection(contextValue, true);

    expect(wrapper.getByTestId(INSIGHTS_HEADER_TEST_ID)).toBeInTheDocument();
    expect(wrapper.getAllByRole('button')[0]).toHaveAttribute('aria-expanded', 'true');
    expect(wrapper.getAllByRole('button')[0]).not.toHaveAttribute('disabled');
  });
});
