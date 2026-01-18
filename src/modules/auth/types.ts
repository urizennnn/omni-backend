export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export type TelegramLoginCache = {
  userId: string;
  phone: string;
  databaseDirectory: string;
};

export type TelegramAuthPromises = {
  resolveAuthCode: (code: string) => void;
  rejectAuthCode: (error: Error) => void;
  resolvePassword: (password: string) => void;
  rejectPassword: (error: Error) => void;
};

export type XOAuthCache = {
  userId: string;
  codeVerifier: string;
  state: string;
};
