// Shape of the ActiveCommunities daily availability response.

export interface TimeSlot {
  id: number;
  start_time: string; // "HH:MM:SS"
  end_time: string; // "HH:MM:SS"
  available: boolean;
  is_cross_day: boolean;
}

// Day status codes, inferred from observed responses (not documented):
//   0 = has open slots, 4 = fully booked, 5 = past,
//   7 = today (no bookable slots), 8 = beyond the booking window
export interface DailyDetail {
  date: string; // "YYYY-MM-DD"
  status: number;
  times: TimeSlot[];
  holiday_desc: string | null;
  check_in_only: boolean;
  check_out_only: boolean;
}

export interface AvailabilityResponse {
  headers: {
    response_code: string; // "0000" on success
    response_message: string;
  };
  body: {
    details: {
      resource_id: number;
      reservation_unit: number;
      daily_details: DailyDetail[];
    };
  };
}
