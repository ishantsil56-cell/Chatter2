import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type AuthStackParamList = {
  SignIn: undefined;
  ProfileSetup: undefined;
};

export type AppStackParamList = {
  Tabs: undefined;
  Chat: { chatId: string };
  NewChat: undefined;
  GroupCreate: { preselected?: string[] } | undefined;
  GroupInfo: { chatId: string };
  Profile: undefined;
  /** Someone else's profile. `uid` may be your own, in which case it offers an edit link. */
  UserProfile: { uid: string };
  Settings: undefined;
  /** Poll composer for a chat. */
  PollCreate: { chatId: string };
  /** App lock set-up. `change` asks for the current PIN first. */
  LockSetup: { mode?: 'create' | 'change' } | undefined;
  /** Privacy & Security, reached from Settings. */
  LockSettings: undefined;
  /** One chat's ledger records. `memberIds` lets the screen unwrap the chat key. */
  LedgerChat: { chatId: string; name?: string; memberIds: string[] };
};

export type TabParamList = {
  Chats: undefined;
  Contacts: undefined;
  Settings: undefined;
  Ledger: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;
