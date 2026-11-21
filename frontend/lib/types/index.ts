// ─── Enums / Union Types ───────────────────────────────────────────────────────

export type OrgStatus = 'active' | 'inactive' | 'pending_setup';

export type BehaviorType = 'expected_behavior' | 'unacceptable_behavior';

export type RoleLevel = 'junior' | 'mid' | 'senior' | 'head';

export type EmploymentType = 'full_time' | 'part_time' | 'contract';

export type EmployeeStatus = 'active' | 'inactive';

// ─── Core Entities ─────────────────────────────────────────────────────────────

export interface OrganizationGroup {
  id: string;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
  updated_at: string;
  organizations?: Organization[];
  _count?: { organizations: number };
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  industry?: string;
  country?: string;
  timezone?: string;
  status: OrgStatus;
  is_test?: boolean;
  created_at: string;
  updated_at: string;
  group?: { id: string; name: string } | null;
  _count?: { members: number; departments: number };
}

export interface OrgDetailMember {
  id: string;
  user_id: string;
  is_admin: boolean;
  is_active: boolean;
  joined_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    country_code?: string | null;
    phone?: string | null;
    is_active: boolean;
  };
  also_in: Array<{ id: string; name: string }>;
}

export interface OrgDetail extends Organization {
  org_identity?: unknown;
  members: OrgDetailMember[];
}

export interface User {
  id: string;
  organization_id?: string;
  name: string;
  email: string;
  country_code?: string | null;
  phone?: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  country_code?: string | null;
  phone?: string | null;
  isSuperAdmin: boolean;
  organizationId: string | null;
  is_admin: boolean;
  isTestOrg?: boolean;
}

export interface OrgMembership {
  id: string;
  organization_id: string;
  user_id: string;
  is_admin: boolean;
  is_active: boolean;
  joined_at: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url?: string | null;
    industry?: string | null;
  };
}

export interface OrgChoice {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  is_admin: boolean;
  joined_at: string;
}

// ─── Org Identity ──────────────────────────────────────────────────────────────

export interface ValueItem {
  title: string;
  description?: string;
}

export interface OrgIdentity {
  id: string;
  organization_id: string;
  vision?: string;
  mission?: string;
  purpose?: string;
  values?: ValueItem[];
  created_at: string;
  updated_at: string;
}

// ─── Culture ───────────────────────────────────────────────────────────────────

export interface CultureStandard {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  type: BehaviorType;
  created_at: string;
  updated_at: string;
}

// ─── Org Chart ─────────────────────────────────────────────────────────────────

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  parent_department_id?: string | null;
  head_user_id?: string | null;
  color?: string | null;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
  _count?: {
    child_departments: number;
    roles: number;
    employee_profiles: number;
  };
  head_user?: {
    name: string;
  };
}

// ─── Roles ─────────────────────────────────────────────────────────────────────

export interface KraItem {
  title: string;
  description: string;
}

export interface KpiItem {
  title: string;
  metric: string;
  target: string;
  unit: string;
}

export interface Role {
  id: string;
  organization_id: string;
  department_id: string;
  title: string;
  job_description?: string;
  kra?: KraItem[];
  kpi?: KpiItem[];
  level: RoleLevel;
  created_at: string;
  updated_at: string;
  department?: {
    name: string;
  };
}

// ─── Employees ─────────────────────────────────────────────────────────────────

export interface EmployeeProfile {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  department_id: string;
  reporting_to_user_id?: string;
  employee_code?: string;
  date_of_joining?: string;
  date_of_birth?: string;
  marriage_date?: string;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
  user?: User;
  role?: Role;
  department?: Department;
  reporting_to?: User;
  system_role_id?: string;
  system_role?: {
    id: string;
    name: string;
    is_admin: boolean;
  } | null;
}

export interface PeopleEvent {
  user_id: string;
  name: string;
  avatar_url?: string | null;
  event_date: string;
  label: string;
  years?: number;
}

export interface PeopleEventsResponse {
  birthdays: PeopleEvent[];
  anniversaries: PeopleEvent[];
  new_hirings: PeopleEvent[];
  work_anniversaries: PeopleEvent[];
}

// ─── API Utilities ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  meta: any;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthTokens {
  access_token: string;
  /** Absent for the web app: its refresh token is an httpOnly cookie, never in the body. */
  refresh_token?: string;
  user: AuthUser;
}

export interface OrgSelectionRequired {
  requires_org_selection: true;
  selection_token: string;
  user: { id: string; name: string; email: string };
  organizations: OrgChoice[];
}

export type LoginResponse = AuthTokens | OrgSelectionRequired;
