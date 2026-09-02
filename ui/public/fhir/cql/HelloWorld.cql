// A simple "Hello, World" CQL library to verify the CQL engine is working.
// Be sure to select one or more Patient resources as context before running this library.
// 
// Author: Preston Lee

library HelloWorld version '1.0.0'

using FHIR version '4.0.1'

include FHIRHelpers version '4.0.1'

context Patient

define HelloWorld :
  'If you\'re seeing this text, the CQL library is working!'

define PatientName :
  First(First(Patient.name).given)+ ' ' + First(Patient.name).family

define PatientAge :
  AgeInYears()

define ActiveConditions :
  [Condition] C where exists(C.clinicalStatus.coding CSCoding where CSCoding.code ~ 'active')
