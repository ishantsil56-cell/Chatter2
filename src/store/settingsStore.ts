/** Small settings store: default country code for phone entry, etc. */

import { create } from 'zustand';
import { DEFAULT_COUNTRY_CODE } from '@/utils/phone';

interface SettingsState {
  countryCode: string;
  setCountryCode(code: string): void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  countryCode: DEFAULT_COUNTRY_CODE,
  setCountryCode: (countryCode) => set({ countryCode }),
}));
