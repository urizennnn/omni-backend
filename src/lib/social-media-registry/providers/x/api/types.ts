export type XUser = {
  id: string;
  name: string;
  username: string;
  created_at?: string;
  description?: string;
  location?: string;
  profile_image_url?: string;
  protected?: boolean;
  verified?: boolean;
};

export type XUserResponse = {
  data: XUser;
};

export type XDmEventType =
  | "MessageCreate"
  | "ParticipantsJoin"
  | "ParticipantsLeave";

export type XMediaKey = string;

export type XAttachment = {
  media_keys?: XMediaKey[];
};

export type XDmEvent = {
  id: string;
  event_type: XDmEventType;
  created_at?: string;
  sender_id?: string;
  dm_conversation_id?: string;
  text?: string;
  attachments?: XAttachment;
  participant_ids?: string[];
};

export type XDmEventsResponse = {
  data: XDmEvent[];
  includes?: {
    users?: XUser[];
  };
  meta?: {
    result_count: number;
    next_token?: string;
  };
};

export type XSendDmResponse = {
  data: {
    dm_conversation_id: string;
    dm_event_id: string;
  };
};

export type XListDmEventsParams = {
  max_results?: number;
  since_id?: string;
  until_id?: string;
  pagination_token?: string;
  event_types?: string;
  dm_conversation_id?: string;
};

export type XSendDmParams = {
  text: string;
  attachments?: {
    media_ids?: string[];
  };
};

export type XCreateDmConversationParams = {
  conversation_type: "Group";
  participant_ids: string[];
  message?: XSendDmParams;
};
