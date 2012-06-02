// Unofficial HAMP Library for Javascript v2
// (C) 2012 Dr Paul Brewer 
// Licensed under version 3 of the GNU General Public License
//
// VARIABLE NAMING CONVENTIONS
//
// Hungarian notation prefixes for variable names:
// bo - borrower
// ol - original loan
// fm - Freddie Mac public data
// ml - modified loan
// po - policy
//
// expected elements in Q hash (case study or UI inputs)
// boMoGrossIncome -- borrowers monthly gross income
// boMoMiscHousingExpense -- borrowers (approved) misc housing expense
// olUnpaid -- original loan unpaid balance
// olHomeMarketValue -- home value in todays market
// olMoRemain -- original loan months remaining
// olRate -- original loan interest rate
// fmCap -- freddie mac cap rate (30 yr PMMS rate)
// poDoPR -- 1 for alternative (principal-reduction) waterfall
// poDoLenderVariation -- check if principal reduction exceeds 5%
//                   if so, lengthen loan then reduce rate
//
// A HAMP result hash contains these elements (outputs)
// all result elements are unformatted strings, should be rounded to nearest dollar for dollar values
// mlTargetAGIPct
// mlPR = Principal Reduction
// mlUnpaid = new Unpaid balance = olUnpaid - mlPR
// mlLTV = 100 * mlUnpaid/olHomeMarketValue 
// mlMoTotalTargetPayment = mlTargetAGIPCT % of bMoGrossIncome
// mlMoMiscHousingExpense = copied from bMoMiscHousingExpense
// mlMoTargetPayment = target for loan payment, == total-misc
// mlRate1to5 -- interest rate first 5 years
// mlMoPayment1to5 -- modified monthly loan payment first 5 years
// mlMonths -- term (length) of modified loan in months
// mlChangeMonths -- months for which rate changes occur -- as a string
// mlChangeRates -- new rates that take effect on the months above -- as a string
// mlChangePayments -- new payments that take effect on the months above -- as a string
// mlBalloon -- balloon payment at the end, if any.  if none, return a zero.


function noFrames() {
	if(top != self) {
		document.write('');
		alert("The web page you are visiting takes content from www.armdisarm.com and tries to display it as part of their own web page. Pressing OK will attempt to load www.armdisarm.com directly.  Thanks -- Dr Paul Brewer armdisarm.com ");
		top.location.replace(self.location.href);
	}
}


UHC = function(){ 
	
	var ml = {};
	var q = {};
    var animationRunning = 0;
	
	function numerize(x){ var xx=1*x; return (isNaN(xx)?x:xx)}
	
	function roundStep(x, step) {
	// returns x rounded to the nearest step
		return step * Math.round(x / step);
	}


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


	function PoverA(r, n) {
		r = r / 1200.0;
		return (1.0 - Math.pow(1.0 + r, -n)) / r;
	}

	function AoverP(r, n) {
		r = r / 1200.0;
		return r / (1.0 - Math.pow(1.0 + r, -n));
	}

	function FoverP(r, n) {
		r = r / 1200.0;
		return Math.pow(1.0 + r, n);
	}

	function PoverF(r, n) {
		r = r / 1200.0;
		return Math.pow(1.0 + r, -n);
	}

	function FoverA(r, n) {
		r = r / 1200.0;
		return (Math.pow(1.0 + r, n) - 1) / r;
	}

	function AoverF(r, n) {
		r = r / 1200.0;
		return r / (Math.pow(1.0 + r, n) - 1);
	}

// end standard time-value-of-money functions

	function StandardLoanPayment(Rate, LoanAmt, TermInMonths) {
	return AoverP(Rate, TermInMonths) * LoanAmt;
	}


	function StandardLoanFutureBalance(Rate, LoanAmt, Month, MonthlyPayment) {
		return FoverP(Rate, Month) * LoanAmt - FoverA(Rate, Month) * MonthlyPayment;
	}

	function VariableRateLoanPaymentArray(LoanAmt, TermInMonths, startRate, MonthArray, RateArray) {
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
		var prevPayment = StandardLoanPayment(prevRate, LoanAmt, TermInMonths);
		var j=0,newMonth=0,newRate=0;

		for(j = 0; j < changes; ++j) {
			newMonth = MonthArray[j];
			newRate = RateArray[j];
			RemainingBalance = StandardLoanFutureBalance(prevRate, RemainingBalance, newMonth - prevMonth, prevPayment);
			payments[j] = StandardLoanPayment(newRate, RemainingBalance, TermInMonths - newMonth);
			prevMonth = newMonth;
			prevRate = newRate;
			prevPayment = payments[j];
		}

		return payments;

	}

	function mlMergeHAMPfuture() {	
		var rate = ml.mlRate1to5;
		if(rate < q.fmCap) {
			var N = Math.floor(q.fmCap - rate);
			var MonthArray = $R(0, N).collect(function(x) {
				return 60 + 12 * x;
			});
			var RateArray = $R(1, N).collect(function(x) {
				return rate + x;
			});
			RateArray.push(q.fmCap);
			var AmortLoan = ml.mlUnpaid - ml.mlBalloon;
			var PaymentChangeArray = VariableRateLoanPaymentArray(AmortLoan, ml.mlMonths, rate, MonthArray, RateArray).collect(Math.round);
			ml.mlChangeMonths = MonthArray.join(' --  ');
			ml.mlChangeRates =  RateArray.join(' -- ');
			ml.mlChangePayments = PaymentChangeArray.join(' -- ');
		}
	}
	
	function elementsML(){
		return $$('span[id^="ml"]');
	}
	
	function readML(){
		elementsML().each(function(el){ml[el.id]=numerize(el.innerHTML);});
		return ml;
	}
	
	function writeML(){
		elementsML().each(function(el){el.update(ml[el.id])});
		return ml;
	}
	
	function elementsQ(){
		return $$('input');
	}
	
	function readQ(){
		elementsQ().each(function(el){
		    if ((el.type === "text") || (el.type === "hidden")){ 
			q[el.id]=numerize(el.value);
		    } else if (el.type === "checkbox"){
			q[el.id]=(el.checked)?1:0;
		    } else {
			q[el.id]='readQException';
		    }
		});
		return q;
	}
	
	function getPayment1to5(){
		return Math.round(StandardLoanPayment(ml.mlRate1to5,ml.mlUnpaid-ml.mlBalloon,ml.mlMonths));
	}

        function policyLengthBeforeRate(){
// see MHA Handbook v3.3, p.81, sect 6.4.4 Variation from the Alternative Modification Waterfall 
// lender is allowed to modify length before reducing rate if more than 5% of principal is forgiven
	return (q.poDoPR && q.poDoLenderVariation && ml.mlPR && (ml.mlPR > (0.05*q.olUnpaid)));
        }

    function doPrincipalReductionByStep(step,floorLTV){ 
	if (!ml.mlUnpaid){ ml.mlUnpaid = q.olUnpaid-ml.mlPR; }
	if (ml.mlUnpaid > (floorLTV*q.olHomeMarketValue)){ 
	    ml.mlPR += step;
	    ml.mlUnpaid = q.olUnpaid-ml.mlPR;
	    ml.mlLTV = Math.round(100*ml.mlUnpaid/q.olHomeMarketValue);
	    ml.mlMoPayment1to5 = getPayment1to5();
	    mlMergeHAMPfuture();
	    ml.mlCalculatorStep = 'Reducing Principal to $'+ml.mlUnpaid;
	    return true;
	}
	return false;
    }
	    

// see MhaHandbook v3.3, section 6.3.2 Step 2 -- Interest Rate Reduction
// If the current rate is not at a 0.125 percentage point increment, servicers
//    should _not_ round the interest rate first. 
// Fix applied to Unofficial Calculator --  May 2012
	function doReduceRateByStep(step, floor){
		if(ml.mlRate1to5 > floor) {
		    ml.mlRate1to5 = ml.mlRate1to5 - step;
		    if (ml.mlRate1to5 < floor){ ml.mlRate1to5 = floor }
			if (ml.mlRate1to5<=0){ ml.mlRate1to5=0.000001;}
			ml.mlMoPayment1to5 = getPayment1to5();
			mlMergeHAMPfuture();
		    ml.mlCalculatorStep = 'Reducing Rate to '+ml.mlRate1to5+'%';
			return true;
		}
		return false;
	}	
	
	
	function doIncreaseLengthByStep(stepMonths, maxLength) {
		if(ml.mlMonths < maxLength) {
			ml.mlMonths += stepMonths;
			ml.mlMoPayment1to5 = getPayment1to5();
			mlMergeHAMPfuture();
		    ml.mlCalculatorStep = 'Increasing time to pay to '+ml.mlMonths+' months';
			return true;
		}
		return false;
	}


	function doIncreaseBalloonByStep(stepBalloon) {
		if(ml.mlBalloon < ml.mlUnpaid) {
			ml.mlBalloon += stepBalloon;
			ml.mlMoPayment1to5 = getPayment1to5();
			mlMergeHAMPfuture();
		    ml.mlCalculatorStep = 'Creating balloon payment of $'+ml.mlBalloon;
			return true;
		}
		return false;
	}
	
	function doAnimationStep(){
	    if (q.poDoPR){
		if (doPrincipalReductionByStep(1000,1.15)){ return true; }
	    }
	    if (policyLengthBeforeRate()){
		if (doIncreaseLengthByStep(1,480)){ return true; }
		if (doReduceRateByStep(0.125, 2.0)){ return true; }
	    } else {
		if (doReduceRateByStep(0.125, 2.0)){ return true; }
		if (doIncreaseLengthByStep(1,480)){ return true; }
	    }
	    if (doIncreaseBalloonByStep(1000)){ return true; }
	    ml.mlCalculatorStep = 'Calculations finished -- Final result';
	    return false;
	}
	
	function init(){
		readQ();
		if (!q.poTargetAGIPct){ q.poTargetAGIPct = 31; }
		ml = {
			'mlUnpaid': q.olUnpaid,
		        'mlPR': 0,
		    'mlLTV': Math.round(100*q.olUnpaid/q.olHomeMarketValue),
			'mlTargetAGIPct': q.poTargetAGIPct,
			'mlMoTotalTargetPayment': Math.round(q.poTargetAGIPct*q.boMoGrossIncome/100.0),
			'mlMoMiscHousingExpense': q.boMoMiscHousingExpense,
			'mlMoTargetPayment': '',
			'mlRate1to5': q.olRate,
			'mlMoPayment1to5': '',
			'mlMonths': q.olMoRemain,
			'mlChangeMonths': 'no changes',
			'mlChangeRates': '',
			'mlChangePayments': '',
			'mlBalloon': 0.00			
		};		
	    ml.mlMoTargetPayment = Math.round(ml.mlMoTotalTargetPayment-ml.mlMoMiscHousingExpense);
	    ml.mlMoPayment1to5 = getPayment1to5();
 	    writeML();
	    return true;
	}

        function loanIsAffordable(){
	    // supposed to stop before going under Target
	    // add small fudge factor to stay close to, but above Target
	    return (ml.mlMoPayment1to5 <= (ml.mlMoTargetPayment*1.01));
	}
	
	function startAnimation(){
	    if (animationRunning === 0){ 
		init();
		if ( loanIsAffordable() ){ 
		    ml.mlCalculatorStep = "This loan already affordable: Final result -- no modification";
		    writeML();
		} else {
		    newAnimation(); 
		    animationRunning=1;
		}
	    }
	    return true;
	}

    function newAnimation(){
	var frameDelay = (q.frameDelay)? q.frameDelay: 0.2;
	animationRunning=1;
	new PeriodicalExecuter(function(pe){ 
		    if ( loanIsAffordable() ||  (!doAnimationStep())){ 
			ml.mlCalculatorStep = 'Finished calculations -- Final result';
			animationRunning=0;
			pe.stop(); 
		    }
		    writeML();
		}, frameDelay);	
	return true;
    }
	
	return {
		'init': init,
		'startAnimation': startAnimation
	};
	
}();
