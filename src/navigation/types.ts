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
};

export type TabParamList = {
  Chats: undefined;
  Contacts: undefined;
  Settings: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;
