import type { SyllabusPage } from "./syllabus-pages.js";

/**
 * A complete synthetic semester for end-to-end testing: five courses (2/3/3/3/4 credits),
 * a 12-hour work week, and daily meals. Each syllabus carries deliberately planted
 * inconsistencies of the kinds the three real syllabi taught us to expect — every trap
 * here was observed in a genuine document first.
 *
 * PLANTED TRAPS (the answer key lives beside each syllabus below):
 *   BIO 240 — weights total 90%; midterm dated Oct 14 in the table but Oct 15 in prose;
 *             lab report due "Week 6" with no date.
 *   HIS 210 — paper due "December 4, 2025" in prose (stale year) vs Dec 4, 2026 in the
 *             table; quizzes "each Friday" though the class meets Tue/Thu.
 *   MAT 205 — problem sets due by week number only ("Week 3"); Exam 2 has no date at all.
 *   ENG 230 — portfolio due "December 9" with no year; submissions listed by week range.
 *   PED 110 — the control: clean, consistent, and it states times of day.
 */

export interface FakeMeeting {
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

export interface FakeCourse {
  key: string;
  name: string;
  code: string;
  credits: number;
  meetings: FakeMeeting[];
  pages: SyllabusPage[];
}

export const FAKE_TERM = {
  name: "Fall 2026",
  /** Monday. */
  startDate: "2026-08-24",
  /** Last day of instruction; finals run Dec 14-18 inside the grace window. */
  endDate: "2026-12-11",
};

/** Tue + Fri evenings and Saturday midday: 4 + 4 + 4 = 12 hours per week. */
export const FAKE_WORK_SHIFTS = [
  { title: "Work shift", commitmentType: "work", daysOfWeek: [2, 5], startTime: "17:00", endTime: "21:00" },
  { title: "Work shift", commitmentType: "work", daysOfWeek: [6], startTime: "10:00", endTime: "14:00" },
];

export const FAKE_MEALS = [
  { title: "Lunch", commitmentType: "meal", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "12:00", endTime: "12:45" },
  { title: "Dinner", commitmentType: "meal", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "18:00", endTime: "18:45" },
];

/** Study windows around classes, work, and meals. */
export const FAKE_AVAILABILITY = [
  { dayOfWeek: 1, startTime: "13:00", endTime: "17:30", energyLevel: "high", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 2, startTime: "14:30", endTime: "16:30", energyLevel: "medium", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 3, startTime: "13:00", endTime: "17:30", energyLevel: "high", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 4, startTime: "17:00", endTime: "21:00", energyLevel: "medium", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 5, startTime: "13:00", endTime: "16:30", energyLevel: "low", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 6, startTime: "14:30", endTime: "17:30", energyLevel: "medium", location: "anywhere", hardness: "soft" },
  { dayOfWeek: 0, startTime: "13:00", endTime: "18:00", energyLevel: "high", location: "library", hardness: "soft" },
];

export const FAKE_COURSES: FakeCourse[] = [
  {
    key: "bio",
    name: "General Biology I",
    code: "BIO 240",
    credits: 4,
    meetings: [
      { daysOfWeek: [1, 3, 5], startTime: "10:00", endTime: "10:50" },
      { daysOfWeek: [4], startTime: "14:00", endTime: "16:50" },
    ],
    pages: [
      {
        page: 1,
        text: `LAKEVIEW COLLEGE
BIO 240: General Biology I with Laboratory
Syllabus Fall 2026
Instructor: Dr. Priya Raman
Course schedule: Lecture Monday, Wednesday & Friday 10:00-10:50 am; Laboratory Thursday 2:00-4:50 pm
Dates of instruction: August 24 - December 11, 2026
Credits: 4 semester hours

COURSE DESCRIPTION
An introduction to cellular biology, genetics, and evolution, with a required weekly
laboratory. Students develop core laboratory technique and scientific writing skills.

GRADING
Laboratory Reports   25%
Exams                40%
Quizzes              15%
Participation        10%

Weekly quizzes are given every Wednesday at the start of lecture and cover the previous
week's material. The lowest quiz score is dropped.

EXAMS
There are three exams. The midterm examination will be held in lecture on October 15,
2026. Exam 1 is September 18, 2026. The final exam is December 16, 2026 during finals
week and is cumulative.`,
      },
      {
        page: 2,
        text: `BIO 240 COURSE SCHEDULE
Dates  Week  Topic  Assignments Due
Aug. 24-28, 2026  1  Introduction; The Cell  none
Aug. 31-Sept. 4, 2026  2  Membranes  Quiz 1
Sept. 7-11, 2026  3  Metabolism  Quiz 2
Sept. 14-18, 2026  4  Photosynthesis  Quiz 3; EXAM 1 September 18, 2026
Sept. 21-25, 2026  5  Cell Division  Quiz 4
Sept. 28-Oct. 2, 2026  6  Genetics I  Quiz 5; Formal Lab Report due Week 6
Oct. 5-9, 2026  7  Genetics II  Quiz 6
Oct. 12-16, 2026  8  Review and MIDTERM October 14, 2026  Quiz 7
Oct. 19-23, 2026  9  Molecular Biology  Quiz 8
Oct. 26-30, 2026  10  Gene Expression  Quiz 9
Nov. 2-6, 2026  11  Biotechnology  Quiz 10
Nov. 9-13, 2026  12  Evolution I  Quiz 11
Nov. 16-20, 2026  13  Evolution II  Quiz 12
Nov. 23-27, 2026  Thanksgiving Break  no class
Nov. 30-Dec. 4, 2026  14  Ecology I  Quiz 13
Dec. 7-11, 2026  15  Ecology II; Review  Lab Notebook due December 10, 2026
FINAL EXAM: December 16, 2026

LABORATORY
Attendance at every laboratory session is mandatory. The Formal Lab Report is a full
scientific write-up of the enzyme kinetics experiment and is worth 100 points within the
Laboratory Reports category.`,
      },
    ],
  },
  {
    key: "his",
    name: "United States History to 1877",
    code: "HIS 210",
    credits: 3,
    meetings: [{ daysOfWeek: [2, 4], startTime: "09:30", endTime: "10:45" }],
    pages: [
      {
        page: 1,
        text: `LAKEVIEW COLLEGE
HIS 210: United States History to 1877
Syllabus Fall 2026
Instructor: Prof. Daniel Okafor
Course schedule: Tuesday & Thursday 9:30-10:45 am
Dates of instruction: August 24 - December 11, 2026
Credits: 3 semester hours

GRADING
Reading Quizzes      20%
Primary Source Essays 30%
Research Paper       25%
Final Exam           25%

Reading quizzes are given each Friday and cover the assigned chapters for that week.
Quizzes are taken online and close at midnight.

RESEARCH PAPER
Each student will write an 8-10 page research paper on an approved topic in early
American history. Topics must be approved by October 6, 2026. The completed paper is
due on or before December 4, 2025 and accounts for 25% of the course grade.`,
      },
      {
        page: 2,
        text: `HIS 210 COURSE SCHEDULE
Dates  Week  Topic  Due
Aug. 25 & 27, 2026  1  Colonial Beginnings  none
Sept. 1 & 3, 2026  2  New England & the Chesapeake  Quiz 1
Sept. 8 & 10, 2026  3  Colonial Society  Quiz 2
Sept. 15 & 17, 2026  4  Road to Revolution  Quiz 3; Essay 1 due September 17, 2026
Sept. 22 & 24, 2026  5  The Revolution  Quiz 4
Sept. 29 & Oct. 1, 2026  6  The Constitution  Quiz 5
Oct. 6 & 8, 2026  7  The Early Republic  Quiz 6; Paper topic approval due October 6, 2026
Oct. 13 & 15, 2026  8  Jeffersonian America  Quiz 7
Oct. 20 & 22, 2026  9  Jacksonian America  Quiz 8; Essay 2 due October 22, 2026
Oct. 27 & 29, 2026  10  Slavery and the Old South  Quiz 9
Nov. 3 & 5, 2026  11  Manifest Destiny  Quiz 10
Nov. 10 & 12, 2026  12  The Coming of the Civil War  Quiz 11
Nov. 17 & 19, 2026  13  The Civil War  Quiz 12; Essay 3 due November 19, 2026
Nov. 24, 2026  Thanksgiving Break  no class Thursday
Dec. 1 & 3, 2026  14  Reconstruction  Quiz 13; Research Paper due December 4, 2026
Dec. 8 & 10, 2026  15  Review  none
FINAL EXAM: December 15, 2026, 9:00 am`,
      },
    ],
  },
  {
    key: "mat",
    name: "Introductory Statistics",
    code: "MAT 205",
    credits: 3,
    meetings: [{ daysOfWeek: [1, 3, 5], startTime: "11:00", endTime: "11:50" }],
    pages: [
      {
        page: 1,
        text: `LAKEVIEW COLLEGE
MAT 205: Introductory Statistics
Syllabus Fall 2026
Instructor: Dr. Elena Vasquez
Course schedule: Monday, Wednesday & Friday 11:00-11:50 am
Dates of instruction: August 24 - December 11, 2026
Credits: 3 semester hours

GRADING
Problem Sets   30%
Exam 1         20%
Exam 2         20%
Final Exam     30%

PROBLEM SETS
There are six problem sets. Problem sets are due at the beginning of class on the
following schedule: Problem Set 1 due Week 3, Problem Set 2 due Week 5, Problem Set 3
due Week 7, Problem Set 4 due Week 10, Problem Set 5 due Week 12, Problem Set 6 due
Week 14. Late problem sets lose 10% per day.

EXAMS
Exam 1 will be given in class on October 2, 2026. The date of Exam 2 will be announced
on the course portal. The final exam is scheduled by the registrar for finals week,
December 14-18, 2026.`,
      },
    ],
  },
  {
    key: "eng",
    name: "Introduction to Creative Writing",
    code: "ENG 230",
    credits: 3,
    meetings: [{ daysOfWeek: [2, 4], startTime: "13:00", endTime: "14:15" }],
    pages: [
      {
        page: 1,
        text: `LAKEVIEW COLLEGE
ENG 230: Introduction to Creative Writing
Syllabus Fall 2026
Instructor: Prof. Marguerite Chen
Course schedule: Tuesday & Thursday 1:00-2:15 pm
Dates of instruction: August 24 - December 11, 2026
Credits: 3 semester hours

GRADING
Workshop Submissions  40%
Workshop Participation 20%
Reading Responses     15%
Final Portfolio       25%

WORKSHOP
Each student submits four pieces for workshop over the semester. Submissions are due by
the Sunday before your assigned workshop week: Submission 1 during Sept. 14-18, 2026,
Submission 2 during Oct. 5-9, 2026, Submission 3 during Nov. 2-6, 2026, and Submission 4
during Nov. 30-Dec. 4, 2026.

READING RESPONSES
A short response to the assigned reading is due each Tuesday in class.

FINAL PORTFOLIO
The final portfolio collects revised versions of all four workshop pieces plus a
reflective introduction. The portfolio is due December 9 and is worth 25% of the
course grade. No late portfolios are accepted.`,
      },
    ],
  },
  {
    key: "ped",
    name: "Lifetime Fitness",
    code: "PED 110",
    credits: 2,
    meetings: [{ daysOfWeek: [1, 3], startTime: "08:00", endTime: "08:50" }],
    pages: [
      {
        page: 1,
        text: `LAKEVIEW COLLEGE
PED 110: Lifetime Fitness
Syllabus Fall 2026
Instructor: Coach Terry Walsh
Course schedule: Monday & Wednesday 8:00-8:50 am
Dates of instruction: August 24 - December 11, 2026
Credits: 2 semester hours

GRADING
Weekly Fitness Logs   40%
Fitness Assessments   40%
Participation         20%

FITNESS LOGS
A weekly fitness log is due each Sunday by 9:00 pm, submitted online. Logs record all
activity for the week and a short reflection. There are 14 logs; the two lowest scores
are dropped.

FITNESS ASSESSMENTS
Baseline assessment: September 2, 2026 in class.
Midterm assessment: October 14, 2026 in class.
Final assessment: December 9, 2026 in class.`,
      },
    ],
  },
];
