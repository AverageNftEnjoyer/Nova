// Shared by Settings -> Local data and POST /api/account/delete. U.B Agents has no accounts or passwords, so wiping
// the local profile is confirmed by typing this word instead.
export const LOCAL_DATA_DELETE_CONFIRMATION = "DELETE"

export interface LocalDataDeleteRequest {
  confirm: string
}
