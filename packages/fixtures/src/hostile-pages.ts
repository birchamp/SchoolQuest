import type { SyllabusPage } from "./syllabus-pages.js";

/**
 * Three real syllabus pages, kept for one purpose: attacking the evidence check.
 *
 * `verifyEvidence` decides whether a model actually read what it claims to have read. Its
 * primary test is an exact substring match, and its fallback is token overlap — 80% of the
 * quoted words longer than two characters have to appear *somewhere* on the page, in any
 * order. That fallback exists because pdf.js drops and reorders characters, and a legitimate
 * quote should not be thrown away over one mangled ligature.
 *
 * The fallback is also the system's softest spot, and these pages are the worst case for it:
 * a page dense in dates, assignment nouns and numbers gives an inventing model a large bag of
 * real words to assemble a fake sentence from. If token overlap can be beaten anywhere, it is
 * beaten here.
 *
 * Chosen from the twenty-syllabus corpus by density, and used by
 * `packages/ai/src/extraction/hostile-model.test.ts`. Instructor names and the institution in
 * TABLE_SCHEDULE_PAGES are replaced; every date, number and structural quirk is untouched.
 */

/**
 * A daily schedule table, five months of it across two pages, from a calculus course.
 *
 * One date per row, topics in fragments, and homework named by section number. Almost every
 * word an invented assignment would want — "Homework", "Test", "Review", "session", every
 * month abbreviation, every day number — is already on the page.
 */
export const DENSE_SCHEDULE_PAGES: SyllabusPage[] = [
    {
      "page": 7,
      "text": "7\n\nSCHEDULE SPRING 2022\n\nDate Topic Homework Due\n\nJan 10 Ch 0 (derivatives,\n\nsubstitution, integration by\n\nparts)\n\nJan 11 Ch 0: U-substitution and\n\nIntegration by Parts\n\nExamples\n\nJan 12 1.1 Arc Length\n\nJan 13 1.2 Average Value\n\nJan 14 1.3 Work (springs,\n\nemptying tank\n\nJan 17 HOLIDAY\n\nJan 18 1.3 Work (emptying a tank) Intro to WebAssign\n\nEntering Symbolic Answers\n\nHomework 0.1, Homework 1.1,\n\nJan 19 1.3 Work (lifting chains,\n\netc)\n\nJan 20 1.3 Hydrostatic Force\n\nJan 21 1.3 Moments & Centers of\n\nMass\n\nJan 24 1.3 Centers of Mass\n\nJan 25 Problem session Homework 1.2, Homework 1.3\n\nJan 26 2.1 Trig Integrals\n\n2.2 Trig Substitution\n\nJan 27 Test 1 Review & HW\n\nsession\n\nJan 28 Test 1\n\nJan 31 2.2 Trig Substitution\n\nFeb 1 Problem session Homework 2.1\n\nFeb 2 2.3 Partial Fractions\n\nFeb 3 Problem Session\n\nFeb 4 2.3 Partial Fractions\n\nFeb 7 2.5 Numerical Integration\n\nFeb 8 Problem Session Homework 2.2, Homework 2.3\n\nFeb 9 2.5 Simpson’s Rule and\n\nError Estimates\n\nFeb 10 2.4 Integral Tables\n\nFeb 11 2.6 Improper Integrals\n\nFeb 14 3.1 Intro to Differential\n\nEquations"
    },
    {
      "page": 8,
      "text": "8\n\nFeb 15 2.6 Improper Integrals\n\nCont. \nHomework 2.4, Homework 2.5\n\nFeb 16 3.1 Slope Fields\n\nFeb 17 Test 2 Review & HW\n\nsession\n\nFeb 18 3.1 Euler’s Method\n\nFeb 21 Test 2\n\nFeb 22 3.2 Separable Equations Homework 2.6, Homework 3.1\n\nFeb 23 3.2 Orthogonal Trajectories\n\nFeb 24 3.3 Exponential Growth\n\nFeb 25 3.3 Logistic Growth\n\n3.3 Newton’s Law\n\nFeb 28 3.3 Mixing Problems\n\nMar 1 3.3 Newton’s Law\n\nExamples\n\n3.3 Compound Interest\n\nHomework 3.2\n\nMar 2 3.4 2\nnd \nOrder Linear d.e\n\nMar 3 Problem Session\n\nMar 4 3.4 2\nnd \nOrder Linear d.e.\n\nMar 7 3.4 Case 3\n\nMar 8 Problem Session Homework 3.3\n\nMar 9 3.4 BVPs\n\n3.5 Undetermined\n\nCoefficients\n\nMar 10 3.5 Undetermined\n\nCoefficients and the\n\nSuperposition Principle\n\nMar 11 3.5 Undetermined\n\nCoefficients\n\nMar 14-\n\nMar 18 SPRING BREAK\n\nMar 21 3.6 Springs\n\nMar 22 Problem Session Homework 3.4\n\nMar 23 3.6 Circuits\n\nMar 24 3.6 Springs/circuits -\n\nRecitation\n\nMar 25 4.1 Sequences\n\nMar 28 4.2 Series\n\nMar 29 Problem session Homework 3.5, Homework 3.6\n\nMar 30 4.2 Series\n\nMar 31 Test 3 Review\n\nApr 1 4.3 Integral & Comparison\n\nTests\n\nApr 4 Test 3\n\nApr 5 4.3 Integral & Comparison\n\nTests \nHomework 4.1"
    }
  ];

/**
 * Grading policy prose from a self-paced maths course: categories, point totals, percentage
 * conversions and late-work rules, with no dated schedule at all.
 *
 * The hostile case here is different from a schedule page. The words are ordinary English and
 * repeat constantly ("worth", "points", "grade", "course", "assignment"), so a fabricated
 * sentence about an assignment that does not exist can reach high overlap without containing
 * a single distinctive term.
 */
export const GRADING_PROSE_PAGES: SyllabusPage[] = [
    {
      "page": 11,
      "text": "calculated based on WebAssignment scores.\n\nA schedule will be given to the class that is designed to help spread things out and set a pace\n\nfor you. You may work ahead of the schedule provided to the class and this is encouraged. If\n\nyou need extra time, you need to communicate with the instructor ahead of time.\n\nExams – 70% of grade\n\nThere are 14 chapter exams, each worth 100 points. You have 60 minutes to complete each\n\nexam within WebAssign.\n\nThe final exam is comprehensive and worth 200 points. You have 120 minutes to complete the\n\nfinal exam.\n\nEach exam is worth roughly 4.4% of the grade for the course. The final is worth approximately\n\n8.8% of the grade for the course.\n\nYou may use your calculator on your exams.\n\nNo exams grades will be dropped.\n\nNo work will be accepted after May 13.\n\nHomework – 20% of grade\n\nEach section of the book has a corresponding homework section in WebAssign. Each chapter's\n\nhomework is worth 100 points and worth roughly 1.4% of the grade for the entire course.\n\nFor chapters 1-11, the sections that you need to work are determined by the diagnostic test. In\n\naddition, homework for sections 6.6, 9.4, and 11.3 is required for all students, regardless of the\n\nresults of the diagnostic exam. The diagnostic exam must be completed before you can begin\n\nthe WebAssign homework.\n\nFor chapters 12-14, all sections of homework must be completed.\n\nWebAssign allows for an extra week after the due date to work homework. There is a 10%\n\npenalty for any work submitted after the assignment is due. To get that extra week to work on\n\nthings, request an extension for the assignment within WebAssign.\n\nNo homework grades will be dropped.\n\nEven though some homework may not be due until after the exam over that material, it is to\n\nyour benefit to work the problems before the exam.\n\nNo work will be accepted after May 13."
    },
    {
      "page": 12,
      "text": "Discussions and Other Assignments – 10% of grade\n\nThere are some assignments that are not homework or exams. These include\n\n■ Completion of a diagnostic exam for chapters 1-11. These are worth 10 points each and are\n\ngraded as complete or incomplete. You get the points if you take the diagnostic exam,\n\nregardless of how well you do on the diagnostic exam.\n\n■ Chapter discussions. There is a discussion for each chapter except for the weeks where we\n\ncover two chapters in one week. These are worth 10 points each. They are graded based on\n\nyour performance in the discussion.\n\n■ Homework for the application sections. Sections 6.6, 9.4, 11.3, and 13.5 have nothing but\n\nstory problems in them. These sections are too long to adequately assess on a diagnostic or\n\nchapter exam, so there is a separate assignment for each of these sections. These sections\n\ndo not count towards the regular chapter homework. These are worth 20 points each.\n\n■ The assignment that explains how to use WebAssign. It is worth 10 points and must be\n\ncompleted before you can begin the other work in WebAssign.\n\nThere are 320 points in this category, so each assignment is worth about 0.3% of the grade for\n\nthe course. The application section homeworks are each worth about 0.6% of the grade for the\n\ncourse.\n\nNo work will be accepted after May 13.\n\nGrading Policy\n\nLetter grades will be assigned to final adjusted scores as follows:\n\nA: 90–100% B: 80–89% C: 70–79% D: 60–69% F: below 60%\n\nFinal scores will be rounded to the nearest integer, so a 79.5% will round up to 80% and be\n\nconsidered a \"B\".\n\nAll grades are subject to audit and correction. Sometimes mistakes are made entering grades,\n\nother times mistakes are made in the grading itself. Your grade may increase or decrease when\n\nthis happens. For this reason, you should strive to do better than the minimum needed for the\n\ngrade you desire.\n\nConsideration may be given to such qualities as participation, attitude, and cooperation to\n\nproduce the optimal learning situation for everyone.\n\nGrades are kept inside the Canvas learning management system.\n\nLate Work\n\nHomework may be attempted up to one week after the due date. There is a 10% penalty for\n\nlate work."
    }
  ];

/**
 * A pharmacy course outline written as a table, every date in `01/08/24` form.
 *
 * pdf.js flattens the columns into a stream, so the page text already reads as fragments in
 * an order nobody wrote. That is exactly the condition the token-overlap fallback was added
 * for — and exactly the condition that makes word order useless as a signal.
 */
export const TABLE_SCHEDULE_PAGES: SyllabusPage[] = [
    {
      "page": 12,
      "text": "COPYRIGHT © 2024 STATE UNIVERSITY\n\n12/22/23 PHA5789C Syllabus\n\nDate /\n\nTime\n\nMod\n\n# Activity Activity Title\n\nContact\n\nTime\n\n(hr) Responsible\n\n01/08/24 2.6 Lecture Video Management of Alzheimer's Disease 1 T. Alvarado\n\nOptional/Suppl\n\nemental\n\nYoutube: Kids Interview People with Dementia -\n\nAlzheimer's Society, Dementia Action Week 2019\n\nOptional/Suppl\n\nemental\n\nYoutube: Alzheimer's Patient Is Overjoyed Daily\n\nWhen She's Told She's Going to be a Grandma,\n\nNew York Post\n\nOptional/Suppl\n\nemental\n\nYoutube: Virtual Dementia Simulates Alzheimer's\n\nSymptoms\n\nUnit Unit 2.7: Multiple Sclerosis\n\n01/09/24 2.7 Lecture Video Multiple Sclerosis 1.5 P. Nakamura\n\nUnit Unit 2.8 TC: Appropriate Self-Care (OTC &\n\nHerbals) for Patients with Neurodegenerative\n\nDisorders\n\n01/10/24 2.8 Lecture Video Appropriate Self-Care for Patients with\n\nNeurodegenerative Disorders\n\n0.46 O. Baptiste\n\nUnit Unit 2.9 TC: Quality Assessment to Develop\n\nTargets for QI\n\n01/10/24 2.9 Lecture Video Quality Assessment to Develop Targets for Quality\n\nImprovement\n\n0.5 R. Sunderland\n\n01/11/24\n\nat 10 -\n\n11:50am\n\n1 & 2 Active Learning\n\nSession\n\nActive Learning Session 1&2 A: Parkinson’s\n\nDisease Case Studies\n\n1 E. Farrow, Jane V\n\nAldrich, John\n\nMarkowitz, Oliver\n\nGrundmann, Rachel\n\nReise, T. Alvarado\n\n01/11/24\n\nat 1 -\n\n2:50pm\n\n1 & 2 Active Learning\n\nSession\n\nActive Learning Session 1&2 B: Alzheimer’s\n\nDementia and Multiple Sclerosis Case Studies\n\n1 E. Farrow, Jane V\n\nAldrich, John\n\nMarkowitz, Oliver\n\nGrundmann, Rachel\n\nReise, T. Alvarado\n\n01/11/24 Quiz (In Class) In Class Graded Quiz 1\n\n3 Module Module 3: Psychotic Spectrum Disorders J. Whitlock\n\nUnit Unit 3.1 Background/Etiology of Psychotic\n\nSpectrum Disorders\n\n01/11/24 3.1 Lecture Video Psychotic Spectrum Disorders: Background and\n\nEtiology\n\n0.75 J. Whitlock\n\nUnit Unit 3.2 Pathophysiology of Psychotic Spectrum\n\nDisorders\n\n01/11/24 3.2 Lecture Video Psychotic Disorders: Pathophysiology 0.58 M. Osei\n\nUnit Unit 3.3 Medicinal Chemistry of Drugs Affecting\n\nDopaminergic, Serotoninergic Systems,\n\nAntipsychotics\n\n01/12/24 3.3 Lecture Video Antipsychotics 1.25 C. Dandridge\n\nUnit Unit 3.4 Pharmacology of Antipsychotic\n\nMedications\n\n01/12/24 3.4 Lecture Video Antipsychotic Drugs: Pharmacology of Therapeutic\n\nEffects and Side Effects (2 lecture videos)\n\n1.5 M. Osei\n\nUnit Unit 3.5 Management of Psychotic Spectrum\n\nDisorders"
    }
  ];
