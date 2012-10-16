// (c) 2012 Paul Brewer
// Part of Unofficial HAMP Loan Modification Calculator
// This File Licensed to the Public under the GNU GPL v2.0 License
// or any later version
// see license file: gpl-2.0.txt
//
// These six functions are textbook time-value-of-money factors.
// Go read wikipeia "Time Value of Money" for a crash course on this subject.
// The original software author, Dr Brewer, taught this subject as part of
// "Engineering Economics" in Hong Kong for about 4 years.
//
// These function convert between
// present values P, future values F, flow values A
// rates are 8 for 8%/year, but n is in months so r is scaled at the
// beginning of each function by 1/1200 so that we can correctly
// apply the classic formulas.
//

TVM = {
    'PoverA': function PoverA(r, n) {
	r = r / 1200.0;
	return (r<0.000001)? n: ( (1.0 - Math.pow(1.0 + r, -n)) / r);
    },

    'AoverP': function AoverP(r, n) {
	r = r / 1200.0;
	return (r<0.000001)? (1/n) : (r / (1.0 - Math.pow(1.0 + r, -n)));
    },

    'FoverP':  function FoverP(r, n) {
	r = r / 1200.0;
	return Math.pow(1.0 + r, n);
    },

    'PoverF': function PoverF(r, n) {
	r = r / 1200.0;
	return Math.pow(1.0 + r, -n);
    },

    'FoverA': function FoverA(r, n) {
	r = r / 1200.0;
	return (r<0.000001)? n : ( (Math.pow(1.0 + r, n) - 1) / r);
    },

    'AoverF': function AoverF(r, n) {
	r = r / 1200.0;
	return (r<0.000001)? (1/n) : ( r / (Math.pow(1.0 + r, n) - 1) );
    }
};
// end standard time-value-of-money functions
 

TVM.StandardLoanPayment = function StandardLoanPayment(Rate, LoanAmt, TermInMonths) {
    return TVM.AoverP(Rate, TermInMonths) * LoanAmt;
};


TVM.StandardLoanFutureBalance = function StandardLoanFutureBalance(Rate, LoanAmt, Month, MonthlyPayment) {
    return TVM.FoverP(Rate, Month) * LoanAmt - TVM.FoverA(Rate, Month) * MonthlyPayment;
};

TVM.VariableRateLoanPaymentArray=function VariableRateLoanPaymentArray(LoanAmt, TermInMonths, startRate, MonthArray, RateArray) {
    // This calculates a payment array for a single complex loan.
    // The payment array is a sparse array and shows the changes in payments.
    //
    // Payments at other months match the previous step, the entire payment
    // profile can be determined as a stairstep function with steps months
    //  given in the MonthArray rates in the RateArray and payments
    // in the output of this function which we call a PaymentArray
    //
    // the loan is for an amortizing, interest-bearing amount LoanAmt
    // the term is TermInMonths
    // the initial interest rate is startRate
    // the MonthArray lists the months when the rates change
    // this array should be strictly increasing
    // the RateArray lists what the rates will be
    // rates may go up or down but the length of the array should match
    // the length of MonthArray
    // the output will be an array of identical length giving monthly payments
    // (to get the start rate monthly payment use "StandardLoanPayment()")
    
    var changes = MonthArray.length;
    var payments = new Array(changes);
    
    // initial state for the for loop; will be updated each iteration
    var RemainingBalance = LoanAmt;
    var prevMonth = 0;
    var prevRate = startRate;
    var prevPayment = TVM.StandardLoanPayment(prevRate, LoanAmt, TermInMonths);
    var j=0,newMonth=0,newRate=0;
    
    for(j = 0; j < changes; ++j) {
	newMonth = MonthArray[j];
	newRate = RateArray[j];
	RemainingBalance = TVM.StandardLoanFutureBalance(prevRate, RemainingBalance, newMonth - prevMonth, prevPayment);
	payments[j] = TVM.StandardLoanPayment(newRate, RemainingBalance, TermInMonths - newMonth);
	prevMonth = newMonth;
	prevRate = newRate;
	prevPayment = payments[j];
    }
    
    return payments;
    
};
