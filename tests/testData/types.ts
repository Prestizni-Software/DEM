export type MongoId = string;

export enum GeoAttachmentType {
    PROTOCOL = "Protocol",
    WORD_PROTOCOL = "WordProtocol",
    MEASUREMENT = "Measurement",
    OTHER = "Other",
}

export enum FileType {
    PROTOCOL = "Protocol",
    WORD_PROTOCOL = "WordProtocol",
    MEASUREMENT = "Measurement",
    OTHER = "Other",
}

export enum MeasuringApparatus {
    GPS = "GPS",
    TOT = "TOT",
    NIV = "NIV",
    UNDEFINED = "UNDEFINED",
    DRON = "DRON"
}

export enum SubordinateType {
    GEODET = "Geodet",
    OFFICE_RAT = "OfficeRat",
    CONSTRUCTION_LEADER = "ConstructionLeader",
    ADMIN = "Admin",
    HEAD_CONSTRUCTION_LEADER = "HeadConstructionLeader",
    SUPERVISOR = "Supervisor",
    OBSERVER = "Observer",
    _ = "_",
}

export enum ApprovementStatus {
  TO_BE_DETERMINED = -1,
  NOT_APPROVED = 0,
  APPROVED = 1
}

export enum TaskStatus {
    WAITING = 'WAITING', // Task is created and waiting to be accepted by Geodet
    ACCEPTED = 'ACCEPTED', // Task is accepted by Geodet and waiting for data
    MEASURED = 'MEASURED',
    DONE = 'DONE'
}

export enum ProtocolStatus {
    WAITING_FOR_MEASUREMENTS = "WAITING",
    PROCESSED = "PROCESSED",
    FOR_REVIEW = "FOR_REVIEW",
    SUPERVISOR = "SUPERVISOR",
    APPROVED = "APPROVED",
    DONE = "DONE"
}

export enum Priority {
  urgent = "urgent",
  notUrgent = "notUrgent",
  LOW = "Nízká",
  MEDIUM = "Střední",
  HIGH = "Vysoká"
}

export enum AssignmentType {
  vym = 0,
  zam = 1,
}

export enum MeasuringMachine {
  GPS = "GPS",
  TOT = "TOT",
  NIV = "NIV",
  UNDEFINED = "UNDEFINED",
  DRON = "DRON"
}

export type Section = {
  //beginning of a section
  from: number;

  //end of a section
  to: number;
};
