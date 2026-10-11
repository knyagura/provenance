// The selling and sign-in operations the screens use. Two implementations: Supabase (real) and an
// in-browser example backend for tests and demos without a database. Screens never call Supabase directly.

export interface Member {
  id: string;
  email: string;
  username: string;
}

export interface DraftMedia {
  id: string;
  shot: string;
  kind: 'photo' | 'video';
  url: string;
}

export interface Draft {
  id: string;
  category: string | null;
  title: string;
  brand: string;
  size: string;
  colour: string;
  condition: string | null;
  description: string;
  pricePence: number | null;
  parcelSize: 'small' | 'medium' | 'large' | null;
  declined: string[];
  published: boolean;
  media: DraftMedia[];
  /** The full serial, readable only by the seller. */
  serial: string;
  updatedAt: string;
}

export type DraftFields = Partial<Pick<Draft, 'category' | 'title' | 'brand' | 'size' | 'colour' | 'condition' | 'description' | 'pricePence' | 'parcelSize' | 'declined'>>;

export interface PreparedMedia {
  blob: Blob;
  kind: 'photo' | 'video';
  contentType: string;
  extension: string;
  width: number | null;
  height: number | null;
  sha256: string;
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; message: string };

export interface SellingBackend {
  /** Current member, or null when signed out. */
  member(): Promise<Member | null>;
  onMemberChange(cb: (m: Member | null) => void): () => void;
  signIn(email: string, password: string): Promise<Result<Member>>;
  /** Creates an account. Supabase may ask the person to confirm their email first (needsConfirmation). */
  signUp(email: string, password: string): Promise<Result<{ needsConfirmation: boolean }>>;
  signOut(): Promise<void>;

  myListings(): Promise<Draft[]>;
  createDraft(category: string): Promise<Result<string>>;
  getDraft(id: string): Promise<Draft | null>;
  saveDraft(id: string, fields: DraftFields): Promise<Result>;
  saveSerial(id: string, serial: string): Promise<Result>;
  addMedia(id: string, shot: string, media: PreparedMedia): Promise<Result<DraftMedia>>;
  removeMedia(id: string, mediaId: string): Promise<Result>;
  publish(id: string): Promise<Result>;
  deleteDraft(id: string): Promise<Result>;
}
