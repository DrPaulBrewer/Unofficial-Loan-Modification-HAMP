// The Unofficial HAMP Lib -- Javascript library
// Estimator/Calculator for Home Affordable Modification Program
// (C) Dr Paul J Brewer July 14, 2010
// License:  This code is hereby licensed to the public under 
// the GNU General Public License version 3, or any later version
// a copy of which may be found at the Free Software Foundation's 
// web site at http://www.gnu.org/licenses/gpl-3.0.html
// or elsewhere on the internet.  
//
// The Prototype extensions to Javascript are in use and any
// web pages using this code will need to load prototype.js first.
// 
// Disclaimer:  There is no warranty for this code, not even the implied 
// warranty of merchantibility or fitness for a particular purpose.
// End users of this code must accept any risk that the code malfunctions,
// causes your wife or girlfriend to leave, or produces other undersirable
// results.
//
//
// The first six functions are textbook time-value-of-money factors.
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

function PoverA(r,n) { 
    r=r/1200.0;
    return (1.0-Math.pow(1.0+r,-n))/r;
}

function AoverP(r,n) {
    r=r/1200.0;
    return r/(1.0-Math.pow(1.0+r,-n));
}

function FoverP(r,n) {
    r=r/1200.0;
    return Math.pow(1.0+r,n);
}

function PoverF(r,n) {
    r=r/1200.0;
    return Math.pow(1.0+r,-n);
}

function FoverA(r,n) {
    r=r/1200.0;
    return (Math.pow(1.0+r,n)-1)/r;
}

function AoverF(r,n) {
    r=r/1200.0;
    return r/(Math.pow(1.0+r,n)-1);
}

//

function StandardLoanPayment(Rate, LoanAmt, TermInMonths) {
    return AoverP(Rate,TermInMonths)*LoanAmt;
}

function StandardLoanFutureBalance(Rate, LoanAmt, Month, MonthlyPayment){ 
    return FoverP(Rate,Month)*LoanAmt-FoverA(Rate,Month)*MonthlyPayment;
}

function PaymentArrayForRateArray(RateTable,LoanAmt,TermInMonths){
    // this holds the loan amount and length of the loan constant
    // and creates as output a table of what the payments would be 
    // given as input a table of alternative rates
    // the rate is held constant for the life of the loan in this case
    // and the payment output provides a way to compare loans with different rates
    return RateTable.collect(
	 function(r){ return StandardLoanPayment(r, LoanAmt, TermInMonths) }
			     );
}

function roundStep(x, step){ 
    // returns x rounded to the nearest step
    return step*Math.round(x/step);
}

function DecreasingRateStepArray(maxRate, minRate, step) { 
    // returns an array consisting of maxRate,maxRate-step,...,minRate
    // part of the HAMP procedures involve lowering the rate
    // on a loan by 0.125% steps until it becomes affordable
    // this facilitates that operation
    var roundedMaxRate = roundStep(maxRate,step);
    var roundedMinRate = roundStep(minRate,step);
    var steps = Math.round((roundedMaxRate-roundedMinRate)/step);
    var rateTable = $R(0,steps).collect(
	      function(n){ return roundedMaxRate-n*step }
					);
    return rateTable;
}

function VariableRateLoanPaymentArray(LoanAmt, TermInMonths, startRate, MonthArray, RateArray){ 
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
    var payments  = new Array(changes);
    
    // initial state for the for loop; will be updated each iteration
    var RemainingBalance = LoanAmt;
    var prevMonth = 0;
    var prevRate  = startRate;
    var prevPayment = StandardLoanPayment(prevRate, LoanAmt, TermInMonths);

    for (var j = 0; j < changes; ++j){
	var newMonth = MonthArray[j];
	var newRate  = RateArray[j];
	RemainingBalance = StandardLoanFutureBalance(prevRate, RemainingBalance, newMonth-prevMonth, prevPayment);
	payments[j] = StandardLoanPayment(newRate, RemainingBalance, TermInMonths-newMonth);
	prevMonth = newMonth;
	prevRate = newRate;
	prevPayment = payments[j];
    }


    return payments;

}

function displayIfMapped(D, M){ 
    D.each(
	   function(pair){ 
	       if (M.get(pair.key)){
		   $(M.get(pair.key)).update(pair.value);
	       }
	   }
	   );
}

// VARIABLE NAMING CONVENTIONS
//
// Hungarian notation prefixes for variable names: 
// b - borrower
// ol - original loan
// fm - Freddie Mac public data
// ml - modified loan
// p - policy
//
// expected elements in Q hash (case study or UI inputs)
// bMoGrossIncome -- borrowers monthly gross income
// olUnpaid -- original loan unpaid balance
// olMoRemain -- original loan months remaining
// olRate -- original loan interest rate
// fmCap -- freddie mac cap rate (30 yr PMMS rate)
//
// A HAMP result hash contains these elements (outputs)
// all result elements are unformatted strings, should be rounded to nearest dollar for dollar values
// mlTargetAGIPct
// mlMoTargetPayment
// mlRate1to5 -- interest rate first 5 years
// mlMoPayment1to5 -- modified monthly loan payment first 5 years
// mlMonths -- term (length) of modified loan in months
// mlChangeMonths -- months for which rate changes occur -- as a string
// mlChangeRates -- new rates that take effect on the months above -- as a string
// mlChangePayments -- new payments that take effect on the months above -- as a string
// mlBalloon -- balloon payment at the end, if any.  if none, return a zero.


function initHAMPanimator(Q,M){
    var result = $H({});
    // defaults
    result.set('mlTargetAGIPct', 31);
    result.set('mlMoTargetPayment', Math.round(result.get('mlTargetAGIPct')*Q.get('bMoGrossIncome')/100.0));
    result.set('mlRate1to5',Q.get('olRate'));
    result.set('mlPayment1to5','');
    result.set('mlMonths',Q.get('olMoRemain'));
    result.set('mlChangeMonths','no changes');
    result.set('mlChangeRates','');
    result.set('mlChangePayments','');    
    result.set('mlBalloon',0);

    if (M){ displayIfMapped(result,M); }

    return true;
}


function mergeHAMPfuture(Q, result) {
    var rate = Number(result.get('mlRate1to5'));
    if (rate < Q.get('fmCap')){ 
	var N = Math.floor(Q.get('fmCap') - rate);
	var MonthArray = $R(0,N).collect(function(x){ return 60+12*x; });
	var RateArray  = $R(1,N).collect(function(x){ return rate+x; });
	RateArray.push(Q.get('fmCap'));
	var AmortLoan = Q.get('olUnpaid') - result.get('mlBalloon');
	var PaymentChangeArray = VariableRateLoanPaymentArray(AmortLoan, 
							      result.get('mlMonths'), 
							      rate, 
							      MonthArray, 
							      RateArray).collect(Math.round);
	result.set('mlChangeMonths',MonthArray.join(' --  '));
	result.set('mlChangeRates',RateArray.join(' -- '));
	result.set('mlChangePayments',PaymentChangeArray.join(' -- '));    
    }
}	    

function stepHAMPanimator(Q, M){
    //
    //  HAMPanimator implements the procedure described in 
    // Treasury Special Directive 09-01 and which has remained similar
    // in later documents.  
    //
    // The procedure is to undertake a series of steps and stop when
    // the loan reaches the affordable level of 31% of gross income.
    // 
    // Steps (in this order; order matters): 
    // Rate Adjust: Drop the loan rate by 0.125% steps to as low as 2% keeping
    // the length of the loan constant.
    //
    // Term Adjust: Add months to the loan if length<480 months (40 years)
    //
    // Forebrearance/Forgiveness:  Forgiveness is not a requirement of the 
    // HAMP program but is voluntary.  Forebearance means the addition
    // of a balloon payment to the end of the loan that is non-interest
    // bearing through the life of the loan. 
    //
    // Finally, and we dont do this step here, there can be a "veto" of the
    // modification in favor of liquidation.  What occurs is a comparison
    // of the value of the modification vs the value of selling the home.
    // This gets fairly complex, and parts of that model are likely to
    // be hidden, although the govenment has disclosed other parts of it.
    //

    var result  = $H();
    var mlMoTargetPayment = Number($(M.get('mlMoTargetPayment')).innerHTML);
    var mlRate1to5 = Number($(M.get('mlRate1to5')).innerHTML);
    var mlBalloon = Number($(M.get('mlBalloon')).innerHTML);

    result.set('mlRate1to5',mlRate1to5);
    result.set('mlBalloon',mlBalloon);

    // check for possibility of rate adjustment

    if ( mlRate1to5 > 2.0 ){
	mlRate1to5 = roundStep(mlRate1to5-0.125,0.125);
	result.set('mlRate1to5',mlRate1to5);
	result.set('mlMonths',Q.get('olMoRemain'));
	var payment = Math.round(StandardLoanPayment(mlRate1to5,
					  Q.get('olUnpaid'),
					  Q.get('olMoRemain')
						    ));
	result.set('mlMoPayment1to5',payment);
	mergeHAMPfuture(Q,result);
	displayIfMapped(result,M);
	return (payment > mlMoTargetPayment );
    }

    // check for possibility of length adjustment

    var mlMonths = Number($(M.get('mlMonths')).innerHTML);
    result.set('mlMonths',mlMonths);	


    if ( mlMonths < 480 ){ 
	++mlMonths;
	result.set('mlMonths',mlMonths);
	var payment = Math.round(StandardLoanPayment(mlRate1to5,
					  Q.get('olUnpaid'),
					  mlMonths
						    ));
	result.set('mlMoPayment1to5',payment);
	mergeHAMPfuture(Q,result);
	displayIfMapped(result,M);
	return (payment  > mlMoTargetPayment );
    }


    if (mlBalloon < Q.get('olUnpaid')) {
	var Bstep = Math.round(0.001*Number(Q.get('olUnpaid')));
	mlBalloon = mlBalloon + Bstep;
	result.set('mlBalloon',mlBalloon);
	var payment = Math.round(StandardLoanPayment(mlRate1to5, Q.get('olUnpaid') - mlBalloon, mlMonths));
	result.set('mlMoPayment1to5',payment);
	mergeHAMPfuture(Q,result);
	displayIfMapped(result,M);
	return (payment > mlMoTargetPayment );
    }
   	
    return false; 
}

function HAMPshowAnimation(Q){ 
    var M = $H();
    ['mlTargetAGIPct',
     'mlMoTargetPayment',
     'mlRate1to5',
     'mlMoPayment1to5',
     'mlMonths',
     'mlChangeMonths',
     'mlChangeRates',
     'mlChangePayments',
     'mlBalloon'].each(function(s){M.set(s,s)});

    initHAMPanimator(Q,M);

    new PeriodicalExecuter(
			   function(pe){
			       var nomore = !(stepHAMPanimator(Q,M));
			       if (nomore) pe.stop();
			   },
			   0.25
			   );

}
	    


function doCalculations(){
    // used with a particular UI as the event listener for pushing
    // a calculate button
    // first hide the output window
    $('Outputs').hide();
    // create a has to hold the user inputs
    var Q = $H({});
    $A(['bMoGrossIncome','olUnpaid','olMoRemain','olRate','fmCap']).each(function(x){Q.set(x,$(x).value)});
    // grab the user inputs from the UI form. 
    // for convenience we use input elements with ids matching what needs
    // to go in the Q array (or was that vice-versa, lol)
    //
    // now calculate the HAMP results
    $('Outputs').show();
    var R = HAMPshowAnimation(Q);
    //

}