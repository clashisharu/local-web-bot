# Example 1 - A function to calculate the factorial of a number.
def factorial(n):
    if n < 0: # Handle negative numbers correctly by returning 0 (since there's no defined "factorial" for negatives).
        return 0
    elif n == 0 or n==1 : # The base case, returns 1 when the input is a single positive integer.
       return 1;
    else:
      fact = n * factorial(n-1)# Recursive call to calculate "factorial" of remaining numbers and multiply them together with current number until it reaches 0 or base case as per above definition, returning the product .
      return (fact)
    
print("Input a positive integer:")   # Get user input.   
num = int(input())                    # Convert the string to an integer so we can calculate its factorial correctly.     
result= factorial(num)                # Call our function with this number as "n". 
if result == None :                  # To avoid any error in case of incorrect input by user (like negative numbers, strings etc).   
   print("The Factorial is: ", num ) # Print the output.    
elif type(result) != int and not isinstance(result , float):     
       print('Invalid Input')         # If result variable contains non integer or none value then show error message to user
else : 
    print ("The factorial of",num ,"is: ", result )           # Else calculate the 